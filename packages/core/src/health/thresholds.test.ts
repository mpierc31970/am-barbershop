// 13-40 (STAFF-13): the shared brief §3 thresholds, pure with an injected clock.
import { describe, expect, it } from "vitest";
import {
  ageMs,
  evaluateAll,
  evaluateCheck,
  HEALTH_CHECKS,
  isAllowedMonitorPath,
  levelFor,
  monitorKeyPaths,
  type MonitorStatusDoc,
} from "./thresholds";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function base(): MonitorStatusDoc {
  return {
    generated_at: NOW.toISOString(),
    version: "dev",
    overall: "ok",
    components: [],
    tenants: [],
    premium: [],
    failsafe: {
      active: false,
      pending_requests: 0,
      deployed: false,
      last_pull: null,
    },
    backups: {
      db_last_success: null,
      tenant_exports_last_success: null,
      restore_rehearsed_at: ago(DAY),
    },
    email: {
      bounce_rate_7d: null,
      complaint_rate_7d: null,
      sending_enabled: true,
      transport_failures_24h: 0,
    },
    jobs: {
      quotes: null,
      media: null,
      assembly: null,
      retention: null,
      billing: null,
      alerts: null,
      reports: null,
      support: null,
      review: null,
      health: null,
      indexing: null,
      demo: null,
      domains: null,
    },
    payments: { failed_webhooks_1h: 0 },
    service_mode: { active: false, scope: null, windows: 0 },
    growth: [],
    indexing: null,
    domains: null,
    review: null,
    chatbot: null,
    media: null,
    forms: null,
    beacon: null,
    hub: null,
  };
}

const supportCheck = HEALTH_CHECKS.find((c) => c.id === "job-support")!;

function withSupport(lastSuccess: string | null): MonitorStatusDoc {
  const s = base();
  s.jobs.support = {
    last_success: lastSuccess,
    failed_steps: [],
    sla_missed_open: 0,
    open_windows: [],
  };
  return s;
}

describe("HEALTH_CHECKS", () => {
  it("has unique ids and cites brief rows", () => {
    const ids = HEALTH_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of HEALTH_CHECKS) {
      expect(c.brief).toBeGreaterThanOrEqual(8);
      expect(c.brief).toBeLessThanOrEqual(51);
    }
    const rows = new Set(HEALTH_CHECKS.map((c) => c.brief));
    for (const n of [
      19, 20, 22, 24, 25, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37, 40, 41,
      42, 43, 44, 45, 46, 47, 50, 51,
    ]) {
      expect(rows.has(n)).toBe(true);
    }
  });

  it("support job: 30 min ok, 3 h warn, 5 h critical, missing none", () => {
    expect(evaluateCheck(supportCheck, withSupport(ago(30 * MIN)), NOW)).toBe(
      "ok",
    );
    expect(evaluateCheck(supportCheck, withSupport(ago(3 * HOUR)), NOW)).toBe(
      "warn",
    );
    expect(evaluateCheck(supportCheck, withSupport(ago(5 * HOUR)), NOW)).toBe(
      "critical",
    );
    expect(evaluateCheck(supportCheck, withSupport(null), NOW)).toBe("none");
    expect(evaluateCheck(supportCheck, base(), NOW)).toBe("none");
  });

  it("support job: a window active > 24 h is critical, SLA miss is warn", () => {
    const s = withSupport(ago(10 * MIN));
    s.jobs.support!.open_windows = [{ code: "W-1", active_hours: 25 }];
    expect(evaluateCheck(supportCheck, s, NOW)).toBe("critical");
    const t = withSupport(ago(10 * MIN));
    t.jobs.support!.sla_missed_open = 1;
    expect(evaluateCheck(supportCheck, t, NOW)).toBe("warn");
  });

  it("restore rehearsal: null or > 90 days warns", () => {
    const c = HEALTH_CHECKS.find((x) => x.id === "restore-rehearsal")!;
    expect(evaluateCheck(c, base(), NOW)).toBe("ok");
    const s = base();
    s.backups!.restore_rehearsed_at = null;
    expect(evaluateCheck(c, s, NOW)).toBe("warn");
    s.backups!.restore_rehearsed_at = ago(91 * DAY);
    expect(evaluateCheck(c, s, NOW)).toBe("warn");
    s.backups = null;
    expect(evaluateCheck(c, s, NOW)).toBe("none");
  });

  it("review scanners: held past 2 business days is critical, capped warns", () => {
    const c = HEALTH_CHECKS.find((x) => x.id === "review-scanners")!;
    const s = base();
    s.review = {
      text_checker: { provider: "keyword", status: "ok" },
      image_moderator: { provider: "none", status: "skipped" },
      link_checker: { provider: "webrisk", status: "capped" },
      held_pages: 0,
      held_oldest_business_days: 0,
      queued_scans: 0,
      webrisk_month_lookups: 100000,
      webrisk_cap: 100000,
    };
    expect(evaluateCheck(c, s, NOW)).toBe("warn");
    s.review.held_oldest_business_days = 3;
    expect(evaluateCheck(c, s, NOW)).toBe("critical");
  });

  it("assembly failed orgs is critical even before a first clean run", () => {
    const c = HEALTH_CHECKS.find((x) => x.id === "job-assembly")!;
    const s = base();
    s.jobs.assembly = { last_success: null, failed_orgs: 1 };
    expect(evaluateCheck(c, s, NOW)).toBe("critical");
    s.jobs.assembly = { last_success: ago(HOUR), failed_orgs: 0 };
    expect(evaluateCheck(c, s, NOW)).toBe("ok");
  });

  it("beacon: stale flush warns only while a non-demo site is live", () => {
    const c = HEALTH_CHECKS.find((x) => x.id === "beacon")!;
    const s = base();
    s.beacon = { last_flush: ago(20 * MIN), dropped: 0, dropped_at: null };
    s.tenants = [
      {
        org_id: "demo00000000000",
        name: "Bella's Salon",
        live_domain: null,
        preview_host: "demo.sites.example",
        live: true,
        suspended: false,
        premium: [],
        demo: true,
      },
    ];
    expect(evaluateCheck(c, s, NOW)).toBe("ok");
    s.tenants.push({
      ...s.tenants[0]!,
      org_id: "live00000000000",
      demo: false,
    });
    expect(evaluateCheck(c, s, NOW)).toBe("warn");
  });

  it("WR-B03: a job or beacon that never ran is judged once a non-demo site is live", () => {
    const live = {
      org_id: "live00000000000",
      name: "Rivera Bakery",
      live_domain: "rivera.example",
      preview_host: null,
      live: true,
      suspended: false,
      premium: [],
      demo: false,
    };
    const health = HEALTH_CHECKS.find((x) => x.id === "job-health")!;
    const assembly = HEALTH_CHECKS.find((x) => x.id === "job-assembly")!;
    const indexing = HEALTH_CHECKS.find((x) => x.id === "job-indexing")!;
    const beacon = HEALTH_CHECKS.find((x) => x.id === "beacon")!;
    const s = base();
    s.jobs.health = { last_success: null, failed_steps: [], open_incidents: 0 };
    s.jobs.assembly = { last_success: null, failed_orgs: 0 };
    s.jobs.indexing = { last_success: null, failed_steps: [] };
    s.beacon = { last_flush: null, dropped: 0, dropped_at: null };
    // Before launch (no live site, or only the demo): nothing to judge.
    for (const c of [health, assembly, indexing, beacon]) {
      expect(evaluateCheck(c, s, NOW)).toBe("none");
    }
    s.tenants = [{ ...live, demo: true }];
    expect(evaluateCheck(health, s, NOW)).toBe("none");
    // After launch: never succeeded reads as very old.
    s.tenants = [live];
    expect(evaluateCheck(health, s, NOW)).toBe("critical");
    expect(evaluateCheck(assembly, s, NOW)).toBe("warn");
    expect(evaluateCheck(indexing, s, NOW)).toBe("warn");
    expect(evaluateCheck(beacon, s, NOW)).toBe("warn");
    expect(
      evaluateCheck(
        supportCheck,
        { ...withSupport(null), tenants: [live] },
        NOW,
      ),
    ).toBe("critical");
    // A missing section (feeder failed) is still none.
    s.jobs.health = null;
    expect(evaluateCheck(health, s, NOW)).toBe("none");
  });

  it("a throwing source reads as none", () => {
    const c = {
      ...supportCheck,
      source: () => {
        throw new Error("x");
      },
    };
    expect(evaluateCheck(c, base(), NOW)).toBe("none");
  });
});

describe("monitor key paths", () => {
  it("walks leaves with [] for arrays and keeps empty containers", () => {
    expect(
      monitorKeyPaths({ a: 1, b: [], c: null, d: [{ e: "x" }], f: {} }).sort(),
    ).toEqual(["a", "b[]", "c", "d[].e", "f"]);
  });

  it("every path of a full base document is allowlisted", () => {
    for (const p of monitorKeyPaths(base())) {
      expect(isAllowedMonitorPath(p), p).toBe(true);
    }
    expect(isAllowedMonitorPath("tenants[].email")).toBe(false);
    expect(isAllowedMonitorPath("jobs.support.open_windows[].org")).toBe(false);
    expect(isAllowedMonitorPath("tenant")).toBe(false);
    expect(isAllowedMonitorPath("tenants[]")).toBe(true);
  });
});

describe("levelFor / evaluateAll / ageMs", () => {
  it("picks the worst level", () => {
    expect(levelFor([])).toBe("none");
    expect(levelFor(["none", "ok"])).toBe("ok");
    expect(levelFor(["ok", "warn", "none"])).toBe("warn");
    expect(levelFor(["warn", "critical", "ok"])).toBe("critical");
  });

  it("evaluates every check in order", () => {
    const out = evaluateAll(base(), NOW);
    expect(out.map((e) => e.id)).toEqual(HEALTH_CHECKS.map((c) => c.id));
    expect(levelFor(out.map((e) => e.level))).toBe("ok");
  });

  it("ageMs treats missing or bad stamps as infinitely old", () => {
    expect(ageMs(null, NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(ageMs("nope", NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(ageMs(ago(HOUR), NOW)).toBe(HOUR);
    expect(ageMs("2026-10-16 11:00:00.000Z", NOW)).toBe(HOUR);
  });
});

describe("P14 domain checks (14-45, brief rows 41-50)", () => {
  function domains(
    patch: Partial<NonNullable<MonitorStatusDoc["domains"]>> = {},
  ): MonitorStatusDoc {
    const s = base();
    s.domains = {
      provider: "fake",
      provider_errors_24h: 0,
      zones_active: 1,
      custom_hosts: 1,
      edge_routes: 4,
      moves_open: 0,
      moves_failed: 0,
      moves_prepared: 0,
      waiting_ns_over_48h: 0,
      gate_overrides_pending: 0,
      post_switch_mismatches: 0,
      https_failing: 0,
      cert_min_days: 60,
      delegation_lost: 0,
      email_drift: 0,
      expiring_30d: 0,
      expiring_7d: 0,
      offboardings_in_notice: 0,
      handbacks_open: 0,
      sending_pending: 0,
      sending_failed: 0,
      last_health_at: ago(HOUR),
      ...patch,
    };
    return s;
  }
  const byId = (id: string) => HEALTH_CHECKS.find((c) => c.id === id)!;
  const level = (id: string, s: MonitorStatusDoc) =>
    evaluateCheck(byId(id), s, NOW);

  it("a healthy domains section is ok everywhere; a null section is none", () => {
    for (const id of [
      "domains-provider",
      "domains-https",
      "domains-drift",
      "domains-expiry",
      "domains-moves",
      "domains-sending",
    ]) {
      expect(level(id, domains()), id).toBe("ok");
      expect(level(id, base()), id).toBe("none");
    }
  });

  it("row 41: any provider error in 24 h warns", () => {
    expect(level("domains-provider", domains({ provider_errors_24h: 1 }))).toBe(
      "warn",
    );
  });

  it("row 42: domains job 10 min ok, 20 min warn, 40 min critical, failed steps warn", () => {
    const j = (last: string | null, failed: string[] = []) => {
      const s = base();
      s.jobs.domains = { last_success: last, failed_steps: failed };
      return s;
    };
    expect(level("job-domains", j(ago(10 * MIN)))).toBe("ok");
    expect(level("job-domains", j(ago(20 * MIN)))).toBe("warn");
    expect(level("job-domains", j(ago(40 * MIN)))).toBe("critical");
    expect(level("job-domains", j(ago(MIN), ["moves"]))).toBe("warn");
    expect(level("job-domains", j(null))).toBe("none");
  });

  it("row 43: HTTPS failing or cert < 7 days critical, cert < 21 days warn, no host none", () => {
    expect(level("domains-https", domains({ https_failing: 1 }))).toBe(
      "critical",
    );
    expect(level("domains-https", domains({ cert_min_days: 5 }))).toBe(
      "critical",
    );
    expect(level("domains-https", domains({ cert_min_days: 14 }))).toBe("warn");
    expect(level("domains-https", domains({ cert_min_days: null }))).toBe("ok");
  });

  it("row 44: delegation lost, email drift or a post-switch mismatch is critical", () => {
    for (const k of [
      "delegation_lost",
      "email_drift",
      "post_switch_mismatches",
    ] as const) {
      expect(level("domains-drift", domains({ [k]: 1 })), k).toBe("critical");
    }
  });

  it("row 45: an IndexNow failure or a sitemap submission error warns", () => {
    const s = base();
    s.indexing = {
      last_weekly_resubmit: null,
      indexnow_failures_24h: 0,
      sitemap_errors: 0,
      sitemap_submit_errors: 0,
    };
    expect(level("indexing-submit", s)).toBe("ok");
    s.indexing.indexnow_failures_24h = 1;
    expect(level("indexing-submit", s)).toBe("warn");
    s.indexing.indexnow_failures_24h = 0;
    s.indexing.sitemap_submit_errors = 2;
    expect(level("indexing-submit", s)).toBe("warn");
  });

  it("row 46: expiring within 7 days critical, within 30 days warn", () => {
    expect(
      level("domains-expiry", domains({ expiring_30d: 1, expiring_7d: 1 })),
    ).toBe("critical");
    expect(level("domains-expiry", domains({ expiring_30d: 1 }))).toBe("warn");
  });

  it("row 47: failed moves, nameservers > 48 h or a pending override warn", () => {
    for (const k of [
      "moves_failed",
      "waiting_ns_over_48h",
      "gate_overrides_pending",
    ] as const) {
      expect(level("domains-moves", domains({ [k]: 1 })), k).toBe("warn");
    }
    expect(
      level("domains-moves", domains({ moves_open: 3, moves_prepared: 1 })),
    ).toBe("ok");
  });

  it("row 50: a failed sending identity warns; pending alone does not", () => {
    expect(level("domains-sending", domains({ sending_failed: 1 }))).toBe(
      "warn",
    );
    expect(level("domains-sending", domains({ sending_pending: 2 }))).toBe(
      "ok",
    );
  });

  it("every domains path of a full document is allowlisted", () => {
    const s = domains();
    s.jobs.domains = { last_success: ago(MIN), failed_steps: ["health"] };
    for (const p of monitorKeyPaths(s)) {
      expect(isAllowedMonitorPath(p), p).toBe(true);
    }
  });
});

// P15 (15-08, P15-P8, A2-Q5): check 51, competitor-claim freshness.
describe("hub claims (check 51)", () => {
  const c = HEALTH_CHECKS.find((x) => x.id === "hub-claims")!;
  const withHub = (days: number | null): MonitorStatusDoc => {
    const s = base();
    s.hub = { claims_verified: 2, claims_draft: 7, oldest_verified_days: days };
    return s;
  };

  it("is brief row 51", () => {
    expect(c.brief).toBe(51);
    expect(c.label).toBe("Hub competitor claims");
  });

  it("null (no verified claims) ok, 150 ok, 151 warn, 183 warn, 184 critical", () => {
    expect(evaluateCheck(c, withHub(null), NOW)).toBe("ok");
    expect(evaluateCheck(c, withHub(150), NOW)).toBe("ok");
    expect(evaluateCheck(c, withHub(151), NOW)).toBe("warn");
    expect(evaluateCheck(c, withHub(183), NOW)).toBe("warn");
    expect(evaluateCheck(c, withHub(184), NOW)).toBe("critical");
  });

  it("a missing hub section is none", () => {
    expect(evaluateCheck(c, base(), NOW)).toBe("none");
  });

  it("every hub path is allowlisted", () => {
    for (const p of monitorKeyPaths(withHub(10))) {
      expect(isAllowedMonitorPath(p), p).toBe(true);
    }
  });
});
