// 11-18: the reporting read model over site_daily_stats (DASH-11, DASH-15, DASH-23;
// Pattern 11, Pitfall 11; T-11-18-01, T-11-18-02).
import { randomBytes } from "node:crypto";
import { InvalidContext, InvalidInput } from "@cds/core";
import { addToHistogram, emptyHistogram } from "@cds/core/analytics";
import { businessDate } from "@cds/core/today";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import {
  MAX_DAILY_STATS_BATCH,
  readSiteStats,
  socialSourceStats,
  sourceKindOf,
  upsertDailyStats,
  weekNumbers,
  type DailyAggregate,
} from "../src/reports/daily-stats";
import { bootPb, type PbInstance } from "./pb-harness";

const SYS = mintSystemContext({ job: "test" });

let inst: PbInstance | null = null;
let pb: PocketBase;

const tag = () => randomBytes(4).toString("hex");
const TZ = "America/Chicago";

async function newOrg(): Promise<{ org: string; ctx: OrgContext }> {
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Stats ${t}`,
      slug: `stats-${t}`,
      status: "active",
      path: "standard",
    })
  ).id;
  await pb
    .collection("business_profile")
    .create({ organization: org, time_zone: TZ });
  const ctx = mintOrgContext({
    orgId: org,
    actor: randomBytes(8).toString("hex").slice(0, 15),
    role: "viewer",
    grants: [],
    ip: "127.0.0.1",
  });
  return { org, ctx };
}

function agg(
  orgId: string,
  over: Partial<DailyAggregate> = {},
): DailyAggregate {
  return {
    orgId,
    day: "2026-10-05",
    path: "/",
    source: "direct",
    device: "m",
    views: 1,
    notFound: 0,
    conversions: 0,
    ...over,
  };
}

async function rowsOf(org: string) {
  return pb.collection("site_daily_stats").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
    sort: "day,path,source,device",
  });
}

function lcp(...ms: number[]): number[] {
  return ms.reduce(
    (h, v) => addToHistogram("lcp", h, v),
    emptyHistogram("lcp"),
  );
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

describe("upsertDailyStats (system write)", () => {
  it("WR-B07: refuses a context not minted by @cds/db (nothing written)", async (t) => {
    if (!inst) return t.skip();
    const { org } = await newOrg();
    const forged = { job: "beacon" } as unknown as typeof SYS;
    await expect(upsertDailyStats(forged, [agg(org)])).rejects.toBeInstanceOf(
      InvalidContext,
    );
    expect(await rowsOf(org)).toHaveLength(0);
  });

  it("sums views and merges vitals for one key; devices make different rows", async (t) => {
    if (!inst) return t.skip();
    const { org } = await newOrg();
    await upsertDailyStats(SYS, [
      agg(org, { views: 2, vitals: { lcp: lcp(1000, 1000) } }),
      agg(org, { device: "c", views: 5 }),
    ]);
    const res = await upsertDailyStats(SYS, [
      agg(org, { views: 3, notFound: 1, vitals: { lcp: lcp(3000) } }),
    ]);
    expect(res).toEqual({ written: 1, dropped: 0 });
    const rows = await rowsOf(org);
    expect(rows).toHaveLength(2);
    const mobile = rows.find((r) => r.device === "m")!;
    expect(mobile.views).toBe(5);
    expect(mobile.not_found).toBe(1);
    const hist = (mobile.vitals as { lcp: number[] }).lcp;
    expect(hist.reduce((s, n) => s + n, 0)).toBe(3);
    expect(rows.find((r) => r.device === "c")!.views).toBe(5);
  });

  it("collapses duplicate keys within one call into one row", async (t) => {
    if (!inst) return t.skip();
    const { org } = await newOrg();
    await upsertDailyStats(SYS, [
      agg(org),
      agg(org),
      agg(org, { conversions: 2 }),
    ]);
    const rows = await rowsOf(org);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.views).toBe(3);
    expect(rows[0]!.conversions).toBe(2);
  });

  it("drops invalid rows and rows for an unknown org; caps the batch at 500", async (t) => {
    if (!inst) return t.skip();
    const { org } = await newOrg();
    const res = await upsertDailyStats(SYS, [
      agg(org, { day: "2026-13-40" }),
      agg(org, { path: "no-slash" }),
      agg(org, { source: "Bad Source!" }),
      agg(org, { device: "x" as never }),
      agg("zzzzzzzzzzzzzzz"),
      agg(org, { views: -4, path: "/ok" }),
    ]);
    expect(res).toEqual({ written: 1, dropped: 5 });
    const rows = await rowsOf(org);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.views).toBe(0);
    expect(MAX_DAILY_STATS_BATCH).toBe(500);
    await expect(
      upsertDailyStats(
        SYS,
        Array.from({ length: 501 }, (_, i) => agg(org, { path: `/p${i}` })),
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
  });
});

describe("readSiteStats (DASH-11)", () => {
  it("returns views, top pages, sources with kind, 404s, p75 LCP and form messages", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await newOrg();
    const { org: other } = await newOrg();
    const today = businessDate(new Date(), TZ);
    const day = (n: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    await upsertDailyStats(SYS, [
      agg(org, { day: day(0), path: "/", source: "google", views: 10 }),
      agg(org, {
        day: day(1),
        path: "/about",
        source: "instagram",
        views: 4,
        conversions: 1,
        vitals: { lcp: lcp(1000, 1000, 1000) },
      }),
      agg(org, {
        day: day(2),
        path: "/about",
        source: "direct",
        device: "c",
        views: 3,
        vitals: { lcp: lcp(5000) },
      }),
      agg(org, { day: day(3), path: "/gone", views: 0, notFound: 2 }),
      agg(org, { day: day(1), path: "/gone", views: 0, notFound: 1 }),
      agg(org, { day: day(9), path: "/old", views: 99 }),
      agg(other, { day: day(0), path: "/secret", views: 500 }),
    ]);
    const form = await pb
      .collection("forms")
      .create({ organization: org, name: "Contact" });
    for (const spam of [false, false, true]) {
      await pb.collection("form_submissions").create({
        organization: org,
        form: form.id,
        form_name: "Contact",
        data: {},
        spam,
      });
    }

    const s = await readSiteStats(ctx, { from: day(6), to: day(0) });
    expect(s.views).toBe(17);
    expect(s.byDay).toHaveLength(7);
    expect(s.byDay[6]).toEqual({ day: day(0), views: 10 });
    expect(s.topPages).toEqual([
      { path: "/", views: 10 },
      { path: "/about", views: 7 },
    ]);
    expect(s.sources).toEqual([
      { source: "google", kind: "search", views: 10, conversions: 0 },
      { source: "instagram", kind: "social", views: 4, conversions: 1 },
      { source: "direct", kind: "direct", views: 3, conversions: 0 },
    ]);
    expect(s.notFound).toEqual([{ path: "/gone", hits: 3, lastSeen: day(1) }]);
    // 1000, 1000, 1000, 5000 -> p75 is the third sample's bucket edge.
    expect(s.vitals.lcp).toEqual({ p75: 1000, rating: "good", samples: 4 });
    expect(s.vitals.inp).toBeNull();
    expect(s.vitalsByDevice.c.lcp?.p75).toBe(5000);
    expect(s.vitalsByDevice.m.lcp?.p75).toBe(1000);
    expect(s.formSubmissions).toBe(2);
    expect(JSON.stringify(s)).not.toContain("/secret");
  });

  it("never shows another org's rows and refuses a bad range", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await newOrg();
    const { org: other } = await newOrg();
    await upsertDailyStats(SYS, [
      agg(other, { day: "2026-10-05", path: "/b", views: 9 }),
    ]);
    const s = await readSiteStats(ctx, {
      from: "2026-10-01",
      to: "2026-10-07",
    });
    expect(s.views).toBe(0);
    expect(s.topPages).toEqual([]);
    expect(s.sources).toEqual([]);
    expect(s.vitals).toEqual({ lcp: null, inp: null, cls: null });
    await expect(
      readSiteStats(ctx, { from: "2026-10-07", to: "2026-10-01" }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      readSiteStats(ctx, { from: "2020-01-01", to: "2026-10-01" }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });
});

describe("weekNumbers (DASH-23)", () => {
  it("compares 7 vs 7 business days across the November DST change", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await newOrg();
    // Wed 4 Nov 2026; DST ends Sun 1 Nov in America/Chicago (inside the previous week).
    const now = new Date("2026-11-04T18:00:00Z");
    const rows: DailyAggregate[] = [];
    for (let d = 26; d <= 31; d++) rows.push(agg(org, { day: `2026-10-${d}` }));
    for (let d = 1; d <= 8; d++) {
      rows.push(agg(org, { day: `2026-11-0${d}`, views: d === 1 ? 1 : 2 }));
    }
    rows.push(agg(org, { day: "2026-10-25", views: 100 }));
    rows.push(agg(org, { day: "2026-11-09", views: 100 }));
    await upsertDailyStats(SYS, rows);

    const w = await weekNumbers(ctx, now);
    expect(w.days.now).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(w.days.prev[0]).toBe("2026-10-26");
    expect(w.days.prev[6]).toBe("2026-11-01");
    expect(w.visitors).toEqual({ now: 14, prev: 7 });
    expect(w.inquiries).toEqual({ now: 0, prev: 0 });
  });

  it("counts this week's form messages, never another org's", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await newOrg();
    const { org: other } = await newOrg();
    for (const o of [org, org, other]) {
      const form = await pb
        .collection("forms")
        .create({ organization: o, name: "Contact" });
      await pb.collection("form_submissions").create({
        organization: o,
        form: form.id,
        form_name: "Contact",
        data: {},
        spam: false,
      });
    }
    const w = await weekNumbers(ctx, new Date());
    expect(w.inquiries).toEqual({ now: 2, prev: 0 });
  });
});

describe("socialSourceStats (DASH-15)", () => {
  it("returns visits and conversions per social platform only", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await newOrg();
    await upsertDailyStats(SYS, [
      agg(org, { source: "instagram", views: 5, conversions: 2 }),
      agg(org, { source: "instagram", path: "/about", views: 3 }),
      agg(org, { source: "facebook", views: 1 }),
      agg(org, { source: "google", views: 40 }),
      agg(org, { source: "example.com", views: 7 }),
    ]);
    const s = await socialSourceStats(ctx, {
      from: "2026-10-01",
      to: "2026-10-07",
    });
    expect(s).toEqual([
      { source: "instagram", visits: 8, conversions: 2 },
      { source: "facebook", visits: 1, conversions: 0 },
    ]);
  });

  it("classifies stored sources", () => {
    expect(sourceKindOf("direct")).toBe("direct");
    expect(sourceKindOf("x")).toBe("social");
    expect(sourceKindOf("bing")).toBe("search");
    expect(sourceKindOf("example.com")).toBe("referral");
    expect(sourceKindOf("spring-sale")).toBe("campaign");
  });
});
