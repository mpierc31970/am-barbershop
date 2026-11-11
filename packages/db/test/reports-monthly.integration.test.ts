// 11-34: the monthly "Your site this month" email job (DASH-12, D189). On the first days of
// a business month every live org whose report month was a full month after launch gets one
// email per eligible member who keeps the type on; a second run the same month sends
// nothing; before launch and the first partial month are skipped; a dry run writes nothing.
// Each case runs with `org` so other tests' orgs in the shared PocketBase never interfere.
import { randomBytes } from "node:crypto";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import { readPlatformMeta } from "../src/platform-meta";
import {
  MONTHLY_TIPS,
  monthlyLines,
  monthlyTip,
  monthRange,
  previousMonth,
  reportMonthFor,
  runMonthlyReports,
} from "../src/reports/monthly";
import type { SiteStats } from "../src/reports/daily-stats";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;

const TZ = "America/Chicago";
/** 1 Nov 2026, 10:00 in Chicago (CDT, UTC-5). */
const NOV_1 = new Date("2026-11-01T15:00:00Z");
const tag = () => randomBytes(4).toString("hex");

type Org = { org: string; name: string; owner: string; ownerEmail: string };

async function newUser(prefix: string): Promise<{ id: string; email: string }> {
  const email = `${prefix}-${tag()}@cds.test`;
  const password = randomBytes(18).toString("hex");
  const id = (
    await pb.collection("users").create({
      email,
      password,
      passwordConfirm: password,
    })
  ).id;
  return { id, email };
}

async function newOrg(stage: string, launchedAt: string | null): Promise<Org> {
  const t = tag();
  const name = `Monthly ${t}`;
  const org = (
    await pb.collection("organizations").create({
      name,
      slug: `monthly-${t}`,
      status: "active",
      path: "standard",
      stage,
      ...(launchedAt ? { launched_at: launchedAt } : {}),
    })
  ).id;
  await pb.collection("business_profile").create({
    organization: org,
    time_zone: TZ,
    business_type: "bakery",
  });
  const owner = await newUser("owner");
  await pb
    .collection("memberships")
    .create({ user: owner.id, organization: org, role: "owner" });
  return { org, name, owner: owner.id, ownerEmail: owner.email };
}

async function addMember(
  o: Org,
  role: "admin" | "editor" | "viewer",
  emailOn?: boolean,
): Promise<string> {
  const u = await newUser(role);
  await pb
    .collection("memberships")
    .create({ user: u.id, organization: o.org, role });
  if (emailOn !== undefined) {
    await pb.collection("member_prefs").create({
      organization: o.org,
      user: u.id,
      alert_channels: { "reports.monthly": { email: emailOn } },
    });
  }
  return u.email;
}

async function stat(
  o: Org,
  day: string,
  path: string,
  source: string,
  views: number,
): Promise<void> {
  await pb.collection("site_daily_stats").create({
    organization: o.org,
    day,
    path,
    source,
    device: "",
    views,
    not_found: 0,
    conversions: 0,
  });
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

function stats(over: Partial<SiteStats> = {}): SiteStats {
  const none = { lcp: null, inp: null, cls: null };
  return {
    views: 0,
    byDay: [],
    topPages: [],
    sources: [],
    notFound: [],
    vitals: none,
    vitalsByDevice: { m: none, t: none, c: none },
    formSubmissions: 0,
    ...over,
  };
}

describe("pure helpers", () => {
  it("months, ranges, due window and tips", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
    expect(monthRange("2026-02")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(reportMonthFor(NOV_1, TZ)).toBe("2026-10");
    // 31 Oct 23:30 Chicago is still October there (not due), though it is 1 Nov in UTC.
    expect(reportMonthFor(new Date("2026-11-01T04:30:00Z"), TZ)).toBeNull();
    expect(reportMonthFor(new Date("2026-11-07T15:00:00Z"), TZ)).toBe(
      "2026-10",
    );
    expect(reportMonthFor(new Date("2026-11-08T15:00:00Z"), TZ)).toBeNull();
    expect(MONTHLY_TIPS.length).toBe(12);
    expect(monthlyTip("2026-10")).toBe(MONTHLY_TIPS[9]);
  });

  it("five lines: visitors with change, top page title, top source, messages, SEO move", () => {
    const lines = monthlyLines({
      month: "2026-10",
      stats: stats({
        views: 1284,
        topPages: [{ path: "/menu", views: 412 }],
        sources: [
          { source: "google", kind: "search", views: 600, conversions: 3 },
        ],
        formSubmissions: 23,
      }),
      prevStats: stats({ views: 1000, formSubmissions: 23 }),
      seoScore: 86,
      prevSeoScore: 80,
      titles: new Map([["/menu", "Menu"]]),
    });
    expect(lines).toEqual([
      "Visitors: 1,284, up 28% on September.",
      "Top page: Menu (412 visits).",
      "Top source: Google (600 visits).",
      "Messages: 23 messages, the same as September.",
      "SEO score: 86 out of 100, up 6 points since last month.",
    ]);
  });

  it("speed wins when it moved more than SEO", () => {
    const lcp = (p75: number) => ({
      lcp: { p75, rating: "good" as const, samples: 50 },
      inp: null,
      cls: null,
    });
    const lines = monthlyLines({
      month: "2026-10",
      stats: stats({ vitals: lcp(1800) }),
      prevStats: stats({ vitals: lcp(2400) }),
      seoScore: 90,
      prevSeoScore: 89,
    });
    expect(lines[4]).toBe(
      "Speed: pages load in 1.8 s, 0.6 s faster than in September.",
    );
    expect(lines[1]).toBe("Top page: no visits yet.");
  });
});

describe("runMonthlyReports (DASH-12)", () => {
  it("a live org launched two months ago gets one email on 1 Nov; a second run sends none", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("live", "2026-09-03 12:00:00.000Z");
    await stat(o, "2026-10-04", "/", "google", 120);
    await stat(o, "2026-10-05", "/menu", "instagram", 40);
    await stat(o, "2026-09-10", "/", "direct", 80);
    const transport = captureTransport();

    const res = await runMonthlyReports({ now: NOV_1, org: o.org, transport });
    expect(res.failedOrgs).toBe(0);
    expect(res.orgsSent).toBe(1);
    expect(res.emailsSent).toBe(1);
    expect(res.month).toBe("October");
    const mine = transport.sent.filter((m) => m.to === o.ownerEmail);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toBe("Your site this month: October");
    expect(mine[0]!.text).toContain("Visitors: 160, up 100% on September.");
    expect(mine[0]!.text).toContain("Top page: Home (120 visits).");
    expect(mine[0]!.text).toContain("Top source: Google (120 visits).");
    expect(mine[0]!.text).toContain("Messages: 0 messages");
    expect(mine[0]!.text).toContain(`One tip: ${MONTHLY_TIPS[9]}.`);
    expect(mine[0]!.text).toContain("/hub/reports");

    const claim = await readPlatformMeta(`reports:monthly:${o.org}:2026-10`);
    expect(claim).not.toBeNull();
    expect(JSON.parse(claim!).sentAt).toBe(NOV_1.toISOString());
    expect(await readPlatformMeta("job:reports:last_success")).toBe(
      NOV_1.toISOString(),
    );
    expect(await readPlatformMeta("job:reports:last_counts")).toContain(
      '"orgsSent":1',
    );

    // Same month, a day later: already sent.
    const again = await runMonthlyReports({
      now: new Date(NOV_1.getTime() + 24 * 3600_000),
      org: o.org,
      transport,
    });
    expect(again.alreadySent).toBe(1);
    expect(again.emailsSent).toBe(0);
    expect(transport.sent.filter((m) => m.to === o.ownerEmail)).toHaveLength(1);
  });

  it("launched 20 Oct: 1 Nov is the first partial month (skipped); being_built is skipped before launch", async (t) => {
    if (!inst) return t.skip();
    const partial = await newOrg("live", "2026-10-20 15:00:00.000Z");
    const building = await newOrg("being_built", null);
    const transport = captureTransport();

    const a = await runMonthlyReports({
      now: NOV_1,
      org: partial.org,
      transport,
    });
    expect(a.skippedFirstMonth).toBe(1);
    expect(a.emailsSent).toBe(0);

    const b = await runMonthlyReports({
      now: NOV_1,
      org: building.org,
      transport,
    });
    expect(b.skippedBeforeLaunch).toBe(1);
    expect(transport.sent).toEqual([]);
    expect(
      await readPlatformMeta(`reports:monthly:${partial.org}:2026-10`),
    ).toBeNull();
  });

  it("recipients: Admin with the type off gets none; Editor and Viewer keep the default (on) unless off", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("live", "2026-08-01 15:00:00.000Z");
    const adminOff = await addMember(o, "admin", false);
    const adminOn = await addMember(o, "admin");
    const editorOff = await addMember(o, "editor", false);
    const viewer = await addMember(o, "viewer");
    const transport = captureTransport();

    const res = await runMonthlyReports({ now: NOV_1, org: o.org, transport });
    const to = transport.sent.map((m) => m.to).sort();
    expect(to).toEqual([o.ownerEmail, adminOn, viewer].sort());
    expect(to).not.toContain(adminOff);
    expect(to).not.toContain(editorOff);
    expect(res.emailsSent).toBe(3);
  });

  it("not in the first seven days of the month: nothing is due", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("live", "2026-08-01 15:00:00.000Z");
    const transport = captureTransport();
    const res = await runMonthlyReports({
      now: new Date("2026-11-12T15:00:00Z"),
      org: o.org,
      transport,
    });
    expect(res.orgsSent + res.skippedBeforeLaunch + res.alreadySent).toBe(0);
    expect(transport.sent).toEqual([]);
  });

  it("a dry run sends nothing, writes nothing and reports planned counts", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg("live", "2026-08-01 15:00:00.000Z");
    await addMember(o, "admin");
    const transport = captureTransport();
    const at = new Date("2026-12-02T16:00:00Z");
    const before = await readPlatformMeta("job:reports:last_success");

    const dry = await runMonthlyReports({
      now: at,
      org: o.org,
      dryRun: true,
      transport,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.orgsSent).toBe(1);
    expect(dry.emailsSent).toBe(2);
    expect(transport.sent).toEqual([]);
    expect(
      await readPlatformMeta(`reports:monthly:${o.org}:2026-11`),
    ).toBeNull();
    expect(await readPlatformMeta("job:reports:last_success")).toBe(before);
  });

  it("rejects a malformed org id", async (t) => {
    if (!inst) return t.skip();
    await expect(
      runMonthlyReports({ now: NOV_1, org: "x' || 1=1" }),
    ).rejects.toThrow(/invalid org id/);
  });
});
