// 11-31 Task 1: the beacon aggregator (DASH-11, DASH-15; Pattern 11, Pitfall 11; T-11-31-01).
// Hits aggregate in memory per (org, business day, path, source, device) and flush through
// upsertDailyStats in batches; a failed flush is retried once on the next tick, then dropped.
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { siteContextForHost } from "../src/content/site-context";
import { mintSystemContext } from "../src/context";
import {
  BEACON_DROPPED_KEY,
  BEACON_LAST_FLUSH_KEY,
  BEACON_OVERFLOW_PATH,
  BeaconAggregator,
  type BeaconAggregatorDeps,
  __resetBeaconForTests,
  flushBeacon,
  ingestBeacon,
  parseBeacon,
  startBeaconFlusher,
  type BeaconEvent,
} from "../src/reports/beacon-ingest";
import {
  upsertDailyStats,
  type DailyAggregate,
} from "../src/reports/daily-stats";
import { clearResolverCache } from "../src/resolve";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;

const tag = () => randomBytes(4).toString("hex");
// 2026-10-06 03:00 UTC is still 2026-10-05 in Chicago.
const NOW = new Date("2026-10-06T03:00:00Z");

async function newOrg(): Promise<{ org: string; host: string }> {
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Beacon ${t}`,
      slug: `beacon-${t}`,
      status: "active",
      path: "standard",
    })
  ).id;
  await pb
    .collection("business_profile")
    .create({ organization: org, time_zone: "America/Chicago" });
  const host = `beacon-${t}.example.com`;
  await pb.collection("org_hosts").create({
    hostname: host,
    organization: org,
    kind: "custom",
    primary: true,
  });
  return { org, host };
}

function ev(over: Partial<BeaconEvent> = {}): BeaconEvent {
  return { t: "v", p: "/", r: "", us: "", um: "", d: "m", ...over };
}

async function rowsOf(org: string) {
  return pb.collection("site_daily_stats").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
    sort: "day,path,source,device",
  });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterEach(() => {
  __resetBeaconForTests();
});

afterAll(async () => {
  await inst?.stop();
});

describe("parseBeacon", () => {
  it("accepts the four shapes and clamps fields", () => {
    expect(
      parseBeacon({ t: "v", p: "/about?x=1#h", d: "t", us: "Instagram" }),
    ).toEqual({ t: "v", p: "/about", r: "", us: "Instagram", um: "", d: "t" });
    expect(parseBeacon({ t: "w", p: "/", lcp: 1200, cls: 0.02 })).toMatchObject(
      {
        t: "w",
        lcp: 1200,
        cls: 0.02,
      },
    );
    expect(parseBeacon({ t: "n", p: "/missing" })?.t).toBe("n");
    expect(parseBeacon({ t: "c", p: "/contact", d: "x" })?.d).toBe("");
  });

  it("refuses malformed payloads", () => {
    for (const bad of [
      null,
      [],
      "v",
      { t: "x", p: "/" },
      { t: "v" },
      { t: "v", p: "about" },
      { t: "v", p: "//evil.example" },
      { t: "v", p: `/${"a".repeat(300)}` },
      { t: "v", p: "/a b" },
      { t: "w", p: "/" },
      { t: "w", p: "/", lcp: -1 },
    ]) {
      expect(parseBeacon(bad)).toBeNull();
    }
    expect(parseBeacon({ t: "v", p: "/", r: "Not a host/" })?.r).toBe("");
  });
});

describe("BeaconAggregator", () => {
  it("aggregates views per key, a second device is its own row, vitals become a histogram", async (t) => {
    if (!inst) return t.skip();
    const { org, host } = await newOrg();
    const meta: [string, string][] = [];
    const agg = new BeaconAggregator({
      now: () => NOW,
      writeMeta: async (k, v) => {
        meta.push([k, v]);
      },
    });
    for (let i = 0; i < 3; i++)
      await agg.add(org, host, ev({ us: "instagram" }));
    await agg.add(org, host, ev({ us: "instagram", d: "c" }));
    await agg.add(
      org,
      host,
      ev({ t: "w", us: "instagram", lcp: 1200, inp: 80 }),
    );
    await agg.add(org, host, ev({ t: "w", us: "instagram", lcp: 3000 }));
    await agg.add(org, host, ev({ t: "c", us: "instagram" }));
    await agg.add(org, host, ev({ t: "n", p: "/gone", r: host }));
    expect(agg.size).toBe(3);

    const res = await agg.flush();
    expect(res).toEqual({ written: 3, dropped: 0, retrying: 0 });
    expect(agg.size).toBe(0);

    const rows = await rowsOf(org);
    expect(rows).toHaveLength(3);
    const mobile = rows.find(
      (r) => r.path === "/" && r.device === "m" && r.source === "instagram",
    )!;
    expect(mobile.day).toBe("2026-10-05");
    expect(mobile.views).toBe(3);
    expect(mobile.conversions).toBe(1);
    const v = mobile.vitals as { lcp: number[]; inp: number[] };
    expect(v.lcp.reduce((s, n) => s + n, 0)).toBe(2);
    expect(v.inp.reduce((s, n) => s + n, 0)).toBe(1);
    expect(rows.find((r) => r.device === "c")!.views).toBe(1);
    // Own-host referrer reads as direct.
    const nf = rows.find((r) => r.path === "/gone")!;
    expect(nf.source).toBe("direct");
    expect(nf.not_found).toBe(1);
    expect(nf.views).toBe(0);

    expect(meta.map(([k]) => k)).toEqual([BEACON_LAST_FLUSH_KEY]);
  });

  it("retries a failed batch once on the next tick, then drops it", async (t) => {
    if (!inst) return t.skip();
    const { org, host } = await newOrg();
    const meta: [string, string][] = [];
    const write = vi.fn((rows: readonly DailyAggregate[]) =>
      upsertDailyStats(mintSystemContext({ job: "test" }), rows),
    );
    write.mockRejectedValueOnce(new Error("pb down"));
    const agg = new BeaconAggregator({
      now: () => NOW,
      write,
      writeMeta: async (k, v) => {
        meta.push([k, v]);
      },
    });
    await agg.add(org, host, ev());
    await agg.add(org, host, ev());
    expect(await agg.flush()).toEqual({ written: 0, dropped: 0, retrying: 1 });
    expect(await rowsOf(org)).toHaveLength(0);
    // Next tick: the retry succeeds together with a new hit.
    await agg.add(org, host, ev({ p: "/new" }));
    expect(await agg.flush()).toEqual({ written: 2, dropped: 0, retrying: 0 });
    const rows = await rowsOf(org);
    expect(rows.find((r) => r.path === "/")!.views).toBe(2);

    // Two failures in a row: dropped and counted.
    write.mockRejectedValueOnce(new Error("pb down"));
    write.mockRejectedValueOnce(new Error("pb down"));
    await agg.add(org, host, ev({ p: "/lost" }));
    expect((await agg.flush()).retrying).toBe(1);
    expect((await agg.flush()).dropped).toBe(1);
    expect(agg.dropped).toBe(1);
    expect(agg.size).toBe(0);
    const dropMeta = meta.filter(([k]) => k === BEACON_DROPPED_KEY);
    expect(dropMeta).toHaveLength(1);
    expect(dropMeta[0]![1]).toMatch(/^1 \d{4}-/);
  });

  it("splits a flush into chunks of at most 500 rows", async () => {
    const sizes: number[] = [];
    const agg = new BeaconAggregator({
      now: () => NOW,
      timeZoneOf: async () => "America/Chicago",
      write: async (rows) => {
        sizes.push(rows.length);
        return { written: rows.length, dropped: 0 };
      },
      writeMeta: async () => undefined,
    });
    for (let i = 0; i < 1203; i++) {
      await agg.add("aaaaaaaaaaaaaaa", "x.example.com", ev({ p: `/p${i}` }));
    }
    expect((await agg.flush()).written).toBe(1203);
    expect(sizes).toEqual([500, 500, 203]);
  });

  it("drops new keys past the memory cap (T-11-31-01)", async () => {
    const agg = new BeaconAggregator({
      timeZoneOf: async () => "America/Chicago",
      write: async (rows) => ({ written: rows.length, dropped: 0 }),
      writeMeta: async () => undefined,
      maxKeys: 2,
    });
    expect(await agg.add("aaaaaaaaaaaaaaa", "x", ev({ p: "/a" }))).toBe(true);
    expect(await agg.add("aaaaaaaaaaaaaaa", "x", ev({ p: "/b" }))).toBe(true);
    expect(await agg.add("aaaaaaaaaaaaaaa", "x", ev({ p: "/c" }))).toBe(false);
    // An existing key still counts.
    expect(await agg.add("aaaaaaaaaaaaaaa", "x", ev({ p: "/a" }))).toBe(true);
    expect(agg.dropped).toBe(1);
  });
});

describe("per-site daily budget (WR-B05)", () => {
  function sinkAgg(over: Partial<BeaconAggregatorDeps> = {}) {
    const written: DailyAggregate[] = [];
    const agg = new BeaconAggregator({
      now: () => NOW,
      timeZoneOf: async () => "America/Chicago",
      write: async (rows) => {
        written.push(...rows);
        return { written: rows.length, dropped: 0 };
      },
      writeMeta: async () => undefined,
      ...over,
    });
    return { agg, written };
  }
  const A = "aaaaaaaaaaaaaaa";
  const B = "bbbbbbbbbbbbbbb";

  it("one noisy site folds new paths into /(other) and never crowds out another site", async () => {
    const { agg, written } = sinkAgg({ maxRowsPerOrgDay: 3, maxKeys: 10 });
    for (let i = 0; i < 50; i++) {
      expect(await agg.add(A, "a.example.com", ev({ p: `/junk${i}` }))).toBe(
        true,
      );
    }
    // A known key keeps counting on its own row.
    await agg.add(A, "a.example.com", ev({ p: "/junk0" }));
    expect(agg.size).toBe(4); // 3 budgeted rows + the overflow row
    expect(await agg.add(B, "b.example.com", ev({ p: "/" }))).toBe(true);
    expect(agg.dropped).toBe(0);
    await agg.flush();
    const aRows = written.filter((r) => r.orgId === A);
    expect(aRows).toHaveLength(4);
    const other = aRows.find((r) => r.path === BEACON_OVERFLOW_PATH)!;
    expect(other.views).toBe(47);
    expect(other.source).toBe("other");
    expect(aRows.find((r) => r.path === "/junk0")!.views).toBe(2);
    expect(written.filter((r) => r.orgId === B)).toHaveLength(1);

    // The budget lasts the business day: the next flush still folds.
    await agg.add(A, "a.example.com", ev({ p: "/fresh" }));
    written.length = 0;
    await agg.flush();
    expect(written.map((r) => r.path)).toEqual([BEACON_OVERFLOW_PATH]);
  });

  it("past the source budget a new source reads other", async () => {
    const { agg, written } = sinkAgg({ maxSourcesPerOrgDay: 2 });
    for (const us of ["one", "two", "three", "four"]) {
      await agg.add(A, "a.example.com", ev({ us, um: "email" }));
    }
    await agg.flush();
    expect(written.map((r) => r.source).sort()).toEqual([
      "one",
      "other",
      "two",
    ]);
    expect(written.find((r) => r.source === "other")!.views).toBe(2);
  });
});

describe("ingestBeacon / flushBeacon (process singleton)", () => {
  it("takes the org only from a SiteContext and writes the heartbeat", async (t) => {
    if (!inst) return t.skip();
    const { org, host } = await newOrg();
    clearResolverCache();
    const site = await siteContextForHost(host);
    expect(site).not.toBeNull();
    await expect(
      ingestBeacon({ orgId: org, host } as never, ev()),
    ).rejects.toThrow();
    startBeaconFlusher();
    startBeaconFlusher();
    expect(process.listenerCount("SIGTERM")).toBeGreaterThan(0);
    await ingestBeacon(site!, ev({ us: "facebook" }));
    await ingestBeacon(site!, ev({ us: "facebook" }));
    const res = await flushBeacon();
    expect(res.written).toBe(1);
    const rows = await rowsOf(org);
    expect(rows[0]!.source).toBe("facebook");
    expect(rows[0]!.views).toBe(2);
    const beat = await pb
      .collection("platform_meta")
      .getFirstListItem(pb.filter("key = {:k}", { k: BEACON_LAST_FLUSH_KEY }));
    expect(Number.isNaN(Date.parse(String(beat.value)))).toBe(false);
  });
});
