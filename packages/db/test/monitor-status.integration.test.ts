// 13-40 (STAFF-16, D175, D290, P13-P28; T-13-40-01, T-13-40-04): the §4 monitor status
// document on the real PocketBase binary. Every top-level key is present, every key path is
// allowlisted and no value carries an "@"; premium[] comes from the manifests the caller
// passes (fixture premium -> one row for the live org, real registry -> none); the demo org is
// listed with demo true and kept out of premium; a throwing feeder nulls its section and
// degrades overall; the whole read stays under 2 s.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MONITOR_DOMAINS_KEYS, MONITOR_STATUS_PATHS } from "@cds/core/health";
import { CLAIMS, oldestVerifiedDays } from "@cds/core/marketing";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_PREMIUM_OK } from "../../core/src/addons/__fixtures__/manifests";
import { resetClientForTests, superuser } from "../src/client";
import { mintPlatformContext } from "../src/context";
import { edgeRoutes } from "../src/dns/edge";
import { staffListSites } from "../src/staff/sites";
import { staffTodayCounts, type StaffTodayFeeders } from "../src/staff/today";
import {
  MONITOR_STATUS_ALLOWLIST,
  monitorStatus,
} from "../src/staff/monitor-status";
import { bootPb, type PbInstance } from "./pb-harness";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3_600_000;

let inst: PbInstance | null = null;
let pb: PocketBase;
let liveOrg = "";
let demoOrg = "";
let storageDir = "";
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function walk(
  v: unknown,
  path: string,
  out: { path: string; value: unknown }[],
): void {
  if (Array.isArray(v)) {
    if (v.length === 0) out.push({ path: `${path}[]`, value: v });
    for (const x of v) walk(x, `${path}[]`, out);
    return;
  }
  if (v !== null && typeof v === "object") {
    const e = Object.entries(v as Record<string, unknown>);
    if (e.length === 0) out.push({ path, value: v });
    for (const [k, x] of e) walk(x, path ? `${path}.${k}` : k, out);
    return;
  }
  out.push({ path, value: v });
}

function allowed(path: string): boolean {
  return MONITOR_STATUS_ALLOWLIST.some(
    (p) => p === path || p.startsWith(`${path}.`) || p.startsWith(`${path}[]`),
  );
}

async function meta(key: string, value: string): Promise<void> {
  await pb.collection("platform_meta").create({ key, value });
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-monitor-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  liveOrg = (
    await pb.collection("organizations").create({
      name: "Rivera Bakery",
      slug: "mon-rivera",
      status: "active",
      stage: "live",
    })
  ).id;
  await pb.collection("org_hosts").create({
    hostname: "riverabakery.example.test",
    organization: liveOrg,
    kind: "custom",
    primary: true,
  });
  await pb.collection("org_hosts").create({
    hostname: "mon-rivera.sites.example.test",
    organization: liveOrg,
    kind: "preview",
    primary: false,
  });
  demoOrg = (
    await pb.collection("organizations").create({
      name: "Bella's Salon",
      slug: "mon-demo",
      status: "active",
      stage: "live",
      demo: true,
    })
  ).id;
  await pb.collection("org_hosts").create({
    hostname: "mon-demo.sites.example.test",
    organization: demoOrg,
    kind: "preview",
    primary: true,
  });
  for (const org of [liveOrg, demoOrg]) {
    await pb.collection("org_addons").create({
      organization: org,
      addon: FIXTURE_PREMIUM_OK.slug,
      status: "active",
      source: "staff",
    });
  }
  await meta("job:support:last_success", ago(HOUR));
  await meta(
    "job:support:last_counts",
    JSON.stringify({
      slaMissedOpen: 1,
      failedSteps: [],
      openWindows: [{ code: "W-12", activeHours: 1.5 }],
    }),
  );
  await meta("job:quotes:last_success", ago(HOUR));
  await meta("job:quotes:last_counts", JSON.stringify({ sendFailures: 2 }));
  await meta(
    "job:reports:last_counts",
    JSON.stringify({ month: "September", emailsSent: 4 }),
  );
  await meta("beacon:last_flush", ago(60_000));
  await meta("beacon:dropped", `3 ${ago(HOUR)}`);
  await meta("backup:restore_rehearsed_at", ago(24 * HOUR));
  await meta("health:incident:job-support", JSON.stringify({ level: "warn" }));
}, 120_000);

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

describe("monitorStatus (13-40)", () => {
  it("emits every §4 top-level key, allowlisted paths only, no '@', in < 2 s", async () => {
    if (!inst) return;
    const t0 = performance.now();
    const doc = await monitorStatus({
      now: NOW,
      manifests: [FIXTURE_PREMIUM_OK],
    });
    expect(performance.now() - t0).toBeLessThan(2000);

    const top = [
      ...new Set(MONITOR_STATUS_PATHS.map((p) => p.split(/[.[]/)[0]!)),
    ];
    expect(Object.keys(doc).sort()).toEqual(top.sort());

    const leaves: { path: string; value: unknown }[] = [];
    walk(doc, "", leaves);
    for (const l of leaves) {
      expect(allowed(l.path), l.path).toBe(true);
      if (typeof l.value === "string")
        expect(l.value, l.path).not.toContain("@");
    }
    expect(JSON.stringify(doc)).not.toContain("@");

    expect(doc.generated_at).toBe(NOW.toISOString());
    expect(doc.components.find((c) => c.id === "pocketbase")).toMatchObject({
      status: "ok",
    });
    expect(doc.jobs.support).toMatchObject({
      sla_missed_open: 1,
      open_windows: [{ code: "W-12", active_hours: 1.5 }],
    });
    expect(doc.jobs.quotes?.send_failures_24h).toBe(2);
    expect(doc.jobs.reports).toMatchObject({
      last_success: null,
      month: "September",
      emails_sent: 4,
    });
    expect(doc.jobs.health?.open_incidents).toBe(1);
    expect(doc.beacon).toMatchObject({ dropped: 3, dropped_at: ago(HOUR) });
    expect(doc.backups?.restore_rehearsed_at).toBe(ago(24 * HOUR));
    expect(doc.failsafe).toMatchObject({ active: false, deployed: false });
    expect(doc.service_mode).toEqual({
      active: false,
      scope: null,
      windows: 0,
    });
    expect(doc.review?.text_checker.provider).toBe("keyword");
    expect(doc.review?.image_moderator).toEqual({
      provider: "none",
      status: "skipped",
    });
    expect(doc.growth).toEqual([]);
    expect(doc.chatbot).toBeNull();
    // A support SLA miss is a warning: overall degraded, not down.
    expect(doc.overall).toBe("degraded");
  });

  it("premium[] comes from the manifests; the demo org is listed but never premium", async () => {
    if (!inst) return;
    const doc = await monitorStatus({
      now: NOW,
      manifests: [FIXTURE_PREMIUM_OK],
    });
    expect(doc.premium).toHaveLength(1);
    expect(doc.premium![0]).toMatchObject({
      org_id: liveOrg,
      addon: FIXTURE_PREMIUM_OK.slug,
      status: "unknown",
    });
    const live = doc.tenants!.find((t) => t.org_id === liveOrg)!;
    expect(live).toMatchObject({
      name: "Rivera Bakery",
      live_domain: "riverabakery.example.test",
      preview_host: "mon-rivera.sites.example.test",
      live: true,
      demo: false,
      premium: [FIXTURE_PREMIUM_OK.slug],
    });
    const demo = doc.tenants!.find((t) => t.org_id === demoOrg)!;
    expect(demo).toMatchObject({ demo: true, premium: [], live_domain: null });

    const real = await monitorStatus({
      now: NOW,
      manifests: ADDON_REGISTRY.list(),
    });
    expect(real.premium).toEqual([]);
    expect(real.tenants!.every((t) => t.premium.length === 0)).toBe(true);
  });

  it("a feeder that throws nulls its section and degrades overall", async () => {
    if (!inst) return;
    const doc = await monitorStatus({
      now: NOW,
      manifests: [],
      feeders: {
        media: () => Promise.reject(new TypeError("boom")),
        indexing: () => Promise.reject(new Error("boom")),
      },
    });
    expect(doc.media).toBeNull();
    expect(doc.jobs.media).toBeNull();
    expect(doc.indexing).toBeNull();
    expect(doc.overall).toBe("degraded");
    expect(doc.tenants).not.toBeNull();
  });

  it("an unreachable PocketBase reads as down", async () => {
    if (!inst) return;
    const doc = await monitorStatus({
      now: NOW,
      feeders: { pocketbase: () => Promise.reject(new Error("down")) },
    });
    expect(doc.components.find((c) => c.id === "pocketbase")).toEqual({
      id: "pocketbase",
      status: "down",
    });
    expect(doc.overall).toBe("down");
  });

  // 15-08 (P15-P8): `hub` is static claims data; counts match CLAIMS and it is emitted even
  // when PocketBase is down (it never degrades with a feeder).
  it("hub counts match CLAIMS and stay emitted when PocketBase is down", async () => {
    if (!inst) return;
    const expected = {
      claims_verified: CLAIMS.filter((c) => c.status === "verified").length,
      claims_draft: CLAIMS.filter((c) => c.status === "draft").length,
      oldest_verified_days: oldestVerifiedDays(CLAIMS, NOW),
    };
    const doc = await monitorStatus({ now: NOW, manifests: [] });
    expect(doc.hub).toEqual(expected);
    expect(doc.hub!.claims_verified + doc.hub!.claims_draft).toBe(
      CLAIMS.length,
    );
    const down = await monitorStatus({
      now: NOW,
      feeders: { pocketbase: () => Promise.reject(new Error("down")) },
    });
    expect(down.hub).toEqual(expected);
  });
});

// 14-45 (DOM-08, CONT-16, LIFE-01; T-14-45-01, T-14-45-02): the P14 `domains` section,
// `jobs.domains` and the real indexing failure counts, from a seeded domain world: one failed
// move (post-switch mismatch), one prepared, one waiting on nameservers for 3 days, one gate
// override pending, one leaving org with an open handback zone, one IndexNow error. The demo
// org's rows are seeded too and never counted.
describe("monitorStatus P14 domains (14-45)", () => {
  let orgD = "";
  let orgB = "";
  let orgLeaving = "";
  let edgeCount = 0;
  const DAY = 24 * HOUR;

  beforeAll(async () => {
    if (!inst) return;
    const mk = async (name: string, slug: string) =>
      (
        await pb.collection("organizations").create({
          name,
          slug,
          status: "active",
          stage: "live",
        })
      ).id;
    orgD = await mk("Mon Domains", "mon-domains");
    orgB = await mk("Mon Prepared", "mon-prepared");
    orgLeaving = await mk("Mon Leaving", "mon-leaving");
    await pb.collection("org_hosts").create({
      hostname: "mondomains.example.test",
      organization: orgD,
      kind: "custom",
      primary: true,
      verified_at: ago(10 * DAY),
    });
    for (const [org, domain] of [
      [orgD, "mondomains.example.test"],
      [orgLeaving, "monleaving.example.test"],
      [demoOrg, "mondemo.example.test"],
    ] as const) {
      await pb.collection("dns_zones").create({
        org_id: org,
        domain,
        provider: "fake",
        status: "active",
      });
    }
    let seq = 9001;
    const move = (
      org: string,
      status: string,
      steps: Record<string, unknown>[],
      extra: Record<string, unknown> = {},
    ) =>
      pb.collection("domain_moves").create({
        seq: seq++,
        org_id: org,
        kind: "launch",
        to_host: "x.example.test",
        status,
        steps,
        ...extra,
      });
    await move(
      orgD,
      "failed",
      [{ key: "delegation", status: "failed", detail: "post_switch_mismatch" }],
      { failed_step: "delegation", current_step: "delegation" },
    );
    await move(orgB, "prepared", [{ key: "gate", status: "done" }]);
    await move(orgLeaving, "waiting_owner", [
      {
        key: "nameservers",
        status: "waiting_owner",
        detail: "waiting_ns",
        startedAt: ago(3 * DAY),
      },
    ]);
    await move(orgB, "running", [
      { key: "gate", status: "waiting", detail: "cds_review" },
    ]);
    // Provider errors: one failed an hour ago (counted), one 3 days ago (not).
    await move(orgD, "cancelled", [
      {
        key: "zone",
        status: "failed",
        detail: "provider_error:rate_limited",
        finishedAt: ago(HOUR),
      },
      {
        key: "snapshot",
        status: "failed",
        detail: "provider_error:auth",
        finishedAt: ago(3 * DAY),
      },
    ]);
    // Demo rows: never counted.
    await move(
      demoOrg,
      "failed",
      [
        {
          key: "zone",
          status: "failed",
          detail: "provider_error:auth",
          finishedAt: ago(HOUR),
        },
      ],
      { failed_step: "zone" },
    );
    await pb.collection("offboardings").create({
      org_id: orgLeaving,
      status: "notice",
      notice_ends_at: new Date(NOW.getTime() + 23 * DAY).toISOString(),
    });
    await pb.collection("offboardings").create({
      org_id: demoOrg,
      status: "notice",
    });
    await pb
      .collection("business_profile")
      .create({ organization: orgD, sending_status: "pending" });
    await pb
      .collection("business_profile")
      .create({ organization: orgLeaving, sending_status: "failed" });
    await pb.collection("org_indexing").create({
      org_id: orgD,
      last_ping_result: "error",
      last_ping_at: ago(HOUR),
    });
    await pb.collection("org_indexing").create({
      org_id: orgB,
      last_ping_result: "error",
      last_ping_at: ago(3 * DAY),
      last_submit_result: "error",
    });
    await pb.collection("org_indexing").create({
      org_id: demoOrg,
      last_ping_result: "error",
      last_ping_at: ago(HOUR),
      last_submit_result: "error",
    });
    await meta(
      "domains:health:summary",
      JSON.stringify({
        https_failing: 0,
        cert_min_days: 45,
        delegation_lost: 0,
        email_drift: 1,
        expiring_30d: 1,
        expiring_7d: 0,
        checked: 1,
        at: ago(6 * HOUR),
      }),
    );
    await meta("job:domains:last_success", ago(2 * 60_000));
    await meta(
      "job:domains:last_counts",
      JSON.stringify({ movesAdvanced: 1, failedSteps: ["health"], ms: 20 }),
    );
    edgeCount = Object.keys(
      (await edgeRoutes({ service: "count" })).http.routers,
    ).length;
  }, 60_000);

  it("emits exact domains counts, jobs.domains and indexing failures; counts only", async () => {
    if (!inst) return;
    const doc = await monitorStatus({ now: NOW, manifests: [] });
    expect(doc.domains).toEqual({
      provider: "fake",
      provider_errors_24h: 1,
      zones_active: 2,
      custom_hosts: 1,
      edge_routes: edgeCount,
      moves_open: 4,
      moves_failed: 1,
      moves_prepared: 1,
      waiting_ns_over_48h: 1,
      gate_overrides_pending: 1,
      post_switch_mismatches: 1,
      https_failing: 0,
      cert_min_days: 45,
      delegation_lost: 0,
      email_drift: 1,
      expiring_30d: 1,
      expiring_7d: 0,
      offboardings_in_notice: 1,
      handbacks_open: 1,
      sending_pending: 1,
      sending_failed: 1,
      last_health_at: ago(6 * HOUR),
    });
    expect(Object.keys(doc.domains!)).toEqual([...MONITOR_DOMAINS_KEYS]);
    expect(edgeCount).toBeGreaterThan(0);
    expect(doc.jobs.domains).toEqual({
      last_success: ago(2 * 60_000),
      failed_steps: ["health"],
    });
    expect(doc.indexing).toMatchObject({
      indexnow_failures_24h: 1,
      sitemap_submit_errors: 1,
    });

    const leaves: { path: string; value: unknown }[] = [];
    walk(doc, "", leaves);
    for (const l of leaves) expect(allowed(l.path), l.path).toBe(true);
    const section = JSON.stringify({
      domains: doc.domains,
      jobs: doc.jobs.domains,
      indexing: doc.indexing,
    });
    for (const secret of [orgD, orgB, orgLeaving, demoOrg, "example.test"]) {
      expect(section).not.toContain(secret);
    }
    // Email drift (row 44) is critical: overall degraded.
    expect(doc.overall).toBe("degraded");
  });

  it("a throwing domains feeder nulls the section and degrades overall", async () => {
    if (!inst) return;
    const doc = await monitorStatus({
      now: NOW,
      manifests: [],
      feeders: { domains: () => Promise.reject(new TypeError("boom")) },
    });
    expect(doc.domains).toBeNull();
    expect(doc.jobs.domains).not.toBeNull();
    expect(doc.overall).toBe("degraded");
  });
});

// 14-45 choice 4: staff Today's six P14 rows and the Sites "Leaving" filter, over the same
// seeded domain world (the describe above ran first; vitest keeps file order).
describe("staff Today P14 rows and Sites Leaving (14-45)", () => {
  const zero = { count: 0 };
  const quiet: Partial<StaffTodayFeeders> = {
    tickets: async () => ({ missed: 0, atRisk: 0, unassigned: 0, open: 0 }),
    review: async () => ({ heldLate: 0, heldDanger: false, held: 0 }),
    reports: async () => ({ open: 0 }),
    fit: async () => zero,
    launch: async () => zero,
    polish: async () => zero,
    incidents: async () => ({ incidents: 0, windows: 0 }),
    ratings: async () => zero,
    health: async () => ({ critical: 0, warn: 0, jobsLate: 0 }),
    failsafe: async () => zero,
  };
  const staff = () =>
    mintPlatformContext({
      actor: "staffmonitor001",
      staffRole: "support_agent",
      ip: "10.0.0.1",
    });

  it("adds the six rows with counts, severities, deep links and P13 ranking; demo never counted", async () => {
    if (!inst) return;
    const orgs = (await pb.collection("organizations").getFullList({
      filter: pb.filter("slug ~ {:p}", { p: "mon-" }),
      fields: "id,slug",
    })) as { id: string; slug: string }[];
    const id = (slug: string) => orgs.find((o) => o.slug === slug)!.id;
    const orgD = id("mon-domains");
    const orgB = id("mon-prepared");
    const orgLeaving = id("mon-leaving");
    await meta(`domains:incident:${orgB}:expiry_7d`, '{"opened_at":"x"}');
    await meta(`domains:incident:${orgD}:expiry_7d`, '{"opened_at":"x"}');
    await meta(`domains:incident:${demoOrg}:expiry_7d`, '{"opened_at":"x"}');
    await meta(`domains:incident:${orgD}:expiry_30d`, '{"opened_at":"x"}');

    const res = await staffTodayCounts(staff(), { now: NOW, feeders: quiet });
    expect(res.failed).toEqual([]);
    const p14 = res.rows
      .filter((r) => r.id.startsWith("domain_") || r.id === "sites_leaving")
      .map((r) => ({
        id: r.id,
        count: r.count,
        severity: r.severity,
        label: r.label,
        href: r.href,
      }));
    expect(p14).toEqual([
      {
        id: "domain_moves_failed",
        count: 1,
        severity: "critical",
        label: "1 domain move failed",
        href: `/staff/sites/${orgD}?tab=domain`,
      },
      {
        id: "domain_post_switch",
        count: 1,
        severity: "critical",
        label: "1 post-switch mismatch",
        href: `/staff/sites/${orgD}?tab=domain`,
      },
      {
        id: "domain_expiring",
        count: 2,
        severity: "critical",
        label: "2 domains expire within 7 days",
        href: "/staff/health",
      },
      {
        id: "domain_gate_override",
        count: 1,
        severity: "warn",
        label: "1 gate waiting for an override",
        href: `/staff/sites/${orgB}?tab=domain`,
      },
      {
        id: "domain_ns_slow",
        count: 1,
        severity: "warn",
        label: "1 site waiting on nameservers over 48 h",
        href: `/staff/sites/${orgLeaving}?tab=domain`,
      },
      {
        id: "sites_leaving",
        count: 1,
        severity: "info",
        label: "1 site leaving CDS",
        href: `/staff/sites/${orgLeaving}?tab=offboarding`,
      },
    ]);
    // A thrown domains source reads "Couldn't count" for all six rows.
    const failed = await staffTodayCounts(staff(), {
      now: NOW,
      feeders: {
        ...quiet,
        domains: () => Promise.reject(new TypeError("boom")),
      },
    });
    expect(failed.failed).toEqual(["domains"]);
    expect(
      failed.rows.filter((r) => r.count === null).map((r) => r.id),
    ).toHaveLength(6);
  });

  it("Sites status=leaving returns only orgs in notice, with days left", async () => {
    if (!inst) return;
    const rows = await staffListSites(staff(), {
      status: "leaving",
      now: NOW,
    });
    const real = rows.filter((r) => !r.demo);
    expect(real.map((r) => r.name)).toEqual(["Mon Leaving"]);
    expect(real[0]!.leavingDays).toBe(23);
    const all = await staffListSites(staff(), { now: NOW });
    expect(all.find((r) => r.name === "Mon Domains")!.leavingDays).toBeNull();
  });
});
