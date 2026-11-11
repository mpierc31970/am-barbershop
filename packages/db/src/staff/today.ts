// Staff Today read model (13-47 choice 1; STAFF-20, STAFF-26, D292, D-UI-P13-5; 13-CONTEXT Area 2
// "Today"; 13-UI-SPEC "Today", "Sidebar"). One fan-out over the EXISTING staff reads, never a
// new query: tickets (staffListTickets), the review queue (listReviewQueue flags + reports),
// Pipeline (staffFitHolds, staffLaunchQueue, staffPolishQueue), incidents and service windows,
// the ratings follow-up list, the Health view and the pending fail-safe count, and the Sites
// list (status line + notices). Promise.allSettled: a source that throws is named in `failed`
// and its rows read "Couldn't count" (ERR-SECTION), never a page error; the log carries the
// error class only. A source the role may not read is skipped (not failed).
//
// Rows are sorted by severity (critical, warn, info), then the CONTEXT order (ROW_ORDER). A row
// with count 0 is absent. Every row is classified through QUEUE_MAP (queueFor) where a queue
// kind exists, so Today and the queues can never disagree about where an item lands (STAFF-26).
// The sidebar badges come from the same counts (UI-SPEC "Sidebar"): Tickets = at-risk + missed
// + unassigned; Pipeline = fit holds + launches ready (P13-P10); Review = held items + open
// reports/DMCA; Health = critical + warning + pending fail-safe. A badge whose source failed is
// null (no badge rather than a wrong one).
//
// 14-45 (DOM-08, LIFE-01; 14-UI-SPEC "Staff Today"): one `domains` source (`readDomainWork`,
// the same read as the monitor's `domains` section) adds six rows: domain moves failed,
// post-switch mismatch, domain expires within 7 days (critical) · gate waiting for an override,
// waiting on nameservers over 48 h (warn) · sites leaving CDS (info). One site links straight
// to its Site › Domain (or Offboarding) tab; more link to Pipeline › Launch, Health or Sites
// filtered to Leaving.
import { authorizeStaff } from "@cds/core";
import { queueFor, type QueueKind } from "@cds/core/staff";
import { assertPlatformContext, type PlatformContext } from "../context";
import { staffListIncidents } from "../support/incidents";
import { staffListTickets } from "../support/staff-tickets";
import { staffListServiceWindows } from "../support/windows";
import { failsafeStatus } from "./failsafe";
import { staffHealthView } from "./health";
import {
  readDomainWork,
  type DomainWorkOrgs,
  type MonitorManifest,
} from "./monitor-status";
import { staffFitHolds, staffLaunchQueue, staffPolishQueue } from "./pipeline";
import { staffRatingsReport } from "./ratings-report";
import { listReviewQueue } from "./review";
import { staffListSites } from "./sites";

export type StaffTodayKind =
  | QueueKind
  | "health"
  | "incident"
  | "window"
  | "rating"
  | "launch"
  | "site"
  | "domain";

export type StaffTodaySeverity = "critical" | "warn" | "info";

/** CONTEXT / UI-SPEC row order (the tie-break after severity). */
export const STAFF_TODAY_ROW_IDS = [
  "sla_missed",
  "sla_at_risk",
  "held_late",
  "health_critical",
  "health_warn",
  "failsafe_pending",
  "domain_moves_failed",
  "domain_post_switch",
  "domain_expiring",
  "domain_gate_override",
  "domain_ns_slow",
  "unassigned",
  "fit_holds",
  "launch_ready",
  "polish",
  "reports_open",
  "ratings_down",
  "incidents_windows",
  "notices",
  "sites_leaving",
] as const;
export type StaffTodayRowId = (typeof STAFF_TODAY_ROW_IDS)[number];

export type StaffTodayRow = {
  id: StaffTodayRowId;
  kind: StaffTodayKind;
  /** null = the source failed ("Couldn't count"). */
  count: number | null;
  severity: StaffTodaySeverity;
  /** "3 tickets at SLA risk"; the bare noun phrase when the count failed. */
  label: string;
  href: string;
  /** Age of the oldest item in ms, when the source knows it. */
  oldestMs?: number;
};

export type StaffTodayStatus = {
  live: number | null;
  building: number | null;
  openTickets: number | null;
  /** Jobs whose heartbeat is past a threshold; null = Health could not be read. */
  jobsLate: number | null;
};

export type StaffTodayBadges = {
  tickets: number | null;
  pipeline: number | null;
  review: number | null;
  health: number | null;
};

export type StaffTodayCounts = {
  rows: StaffTodayRow[];
  status: StaffTodayStatus;
  badges: StaffTodayBadges;
  /** Source names that threw (log + "Couldn't count"). */
  failed: string[];
};

// ---------------------------------------------------------------------------------------
// Sources (feeders; tests replace one to prove the failure path)

type TicketsFeed = {
  missed: number;
  atRisk: number;
  unassigned: number;
  open: number;
  oldestMissedMs?: number;
  oldestAtRiskMs?: number;
  oldestUnassignedMs?: number;
};
type ReviewFeed = { heldLate: number; heldDanger: boolean; held: number };
type ReportsFeed = { open: number };
type CountFeed = { count: number };
type IncidentsFeed = { incidents: number; windows: number };
type HealthFeed = { critical: number; warn: number; jobsLate: number };
type SitesFeed = { live: number; building: number; notices: number };
type DomainsFeed = DomainWorkOrgs;

export type StaffTodayFeeders = {
  tickets(ctx: PlatformContext, now: Date): Promise<TicketsFeed>;
  review(ctx: PlatformContext, now: Date): Promise<ReviewFeed>;
  reports(ctx: PlatformContext, now: Date): Promise<ReportsFeed>;
  fit(ctx: PlatformContext): Promise<CountFeed>;
  launch(ctx: PlatformContext): Promise<CountFeed>;
  polish(ctx: PlatformContext): Promise<CountFeed>;
  incidents(ctx: PlatformContext, now: Date): Promise<IncidentsFeed>;
  ratings(ctx: PlatformContext, now: Date): Promise<CountFeed>;
  health(
    ctx: PlatformContext,
    now: Date,
    manifests: readonly MonitorManifest[],
  ): Promise<HealthFeed>;
  failsafe(ctx: PlatformContext): Promise<CountFeed>;
  sites(ctx: PlatformContext, now: Date): Promise<SitesFeed>;
  domains(ctx: PlatformContext, now: Date): Promise<DomainsFeed>;
};

type FeederName = keyof StaffTodayFeeders;

/** The STAFF_MATRIX feature each source needs (a role without it skips the source). */
const FEATURE: Record<FeederName, string> = {
  tickets: "support_read",
  review: "review_queue",
  reports: "review_queue",
  fit: "console",
  launch: "console",
  polish: "console",
  incidents: "incident_run",
  ratings: "support_read",
  health: "health",
  failsafe: "failsafe_requests",
  sites: "console",
  domains: "domains",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function oldest(ages: number[]): number | undefined {
  return ages.length ? Math.max(...ages) : undefined;
}

const WAITING_ON_CDS = new Set(["open", "in_progress", "waiting"]);
const BUILDING_STATES = new Set([
  "building",
  "ready_for_build",
  "ready_for_review",
]);

export const DEFAULT_TODAY_FEEDERS: StaffTodayFeeders = {
  async tickets(ctx, now) {
    const rows = await staffListTickets(ctx, { status: "active", now });
    const missed = rows.filter((r) => r.sla === "missed");
    const atRisk = rows.filter((r) => r.sla === "due_soon");
    const open = rows.filter((r) => WAITING_ON_CDS.has(r.status));
    const unassigned = open.filter((r) => r.assigneeId === null);
    const out: TicketsFeed = {
      missed: missed.length,
      atRisk: atRisk.length,
      unassigned: unassigned.length,
      open: open.length,
    };
    const m = oldest(missed.map((r) => r.ageMs));
    const a = oldest(atRisk.map((r) => r.ageMs));
    const u = oldest(unassigned.map((r) => r.ageMs));
    if (m !== undefined) out.oldestMissedMs = m;
    if (a !== undefined) out.oldestAtRiskMs = a;
    if (u !== undefined) out.oldestUnassignedMs = u;
    return out;
  },
  async review(ctx, now) {
    const items = await listReviewQueue(ctx, { tab: "flags", now });
    const holds = items.filter((i) => i.kind === "scan_hold");
    const late = holds.filter((i) => (i.heldBusinessDays ?? 0) >= 1);
    // Held items for the Review badge (UI-SPEC "held items"): scan holds only. Fit holds are
    // Pipeline's (P13-P10); unsure flags and queued scans are listed on the tab, not badged.
    return {
      heldLate: late.length,
      heldDanger: late.some((i) => i.pastPromise),
      held: holds.length,
    };
  },
  async reports(ctx, now) {
    const items = await listReviewQueue(ctx, { tab: "reports", now });
    return { open: items.length };
  },
  async fit(ctx) {
    return { count: (await staffFitHolds(ctx)).length };
  },
  async launch(ctx) {
    return { count: (await staffLaunchQueue(ctx)).length };
  },
  async polish(ctx) {
    return { count: (await staffPolishQueue(ctx)).length };
  },
  async incidents(ctx, now) {
    const [incidents, windows] = await Promise.all([
      staffListIncidents(ctx),
      staffCanFeature(ctx, "service_window_org")
        ? staffListServiceWindows(ctx, {}, { now: () => now })
        : Promise.resolve([]),
    ]);
    return {
      incidents: incidents.filter((i) => i.status === "open").length,
      windows: windows.filter((w) => w.phase === "active").length,
    };
  },
  async ratings(ctx, now) {
    return {
      count: (await staffRatingsReport(ctx, { now })).toFollowUp.length,
    };
  },
  async health(ctx, now, manifests) {
    const view = await staffHealthView(ctx, { now, manifests });
    return {
      critical: view.checks.filter((c) => c.level === "critical").length,
      warn: view.checks.filter((c) => c.level === "warn").length,
      jobsLate: view.jobs.filter(
        (j) => j.level === "warn" || j.level === "critical",
      ).length,
    };
  },
  async failsafe() {
    return { count: (await failsafeStatus()).pending_requests };
  },
  async sites(ctx, now) {
    const rows = await staffListSites(ctx, { now });
    const real = rows.filter((r) => !r.demo);
    return {
      live: real.filter((r) => r.state === "live").length,
      building: real.filter((r) => BUILDING_STATES.has(r.state)).length,
      notices: real.filter((r) => r.state === "notice").length,
    };
  },
  async domains(_ctx, now) {
    return (await readDomainWork(now)).orgs;
  },
};

function staffCanFeature(ctx: PlatformContext, feature: string): boolean {
  try {
    authorizeStaff(ctx.staffRole, feature);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// Rows

const SEVERITY_RANK: Record<StaffTodaySeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

type RowDef = {
  id: StaffTodayRowId;
  kind: StaffTodayKind;
  href: string;
  /** Shown with "Couldn't count" when the source failed. */
  noun: string;
};

/** Every row's queue classification goes through QUEUE_MAP where a queue kind exists. */
const ticketQueue = queueFor("problem");
const reviewQueue = queueFor("scan_hold");
const fitQueue = queueFor("fit_hold");
const reportQueue = queueFor("report");
const polishQueue = queueFor("polish");

const ROW: Record<StaffTodayRowId, RowDef> = {
  sla_missed: {
    id: "sla_missed",
    kind: ticketQueue,
    href: "/staff/tickets?sla=missed",
    noun: "Tickets missed SLA",
  },
  sla_at_risk: {
    id: "sla_at_risk",
    kind: ticketQueue,
    href: "/staff/tickets?sla=at-risk",
    noun: "Tickets at SLA risk",
  },
  held_late: {
    id: "held_late",
    kind: reviewQueue,
    href: "/staff/review",
    noun: "Held pages",
  },
  health_critical: {
    id: "health_critical",
    kind: "health",
    href: "/staff/health",
    noun: "Health checks",
  },
  health_warn: {
    id: "health_warn",
    kind: "health",
    href: "/staff/health",
    noun: "Health warnings",
  },
  failsafe_pending: {
    id: "failsafe_pending",
    kind: "health",
    href: "/staff/health?tab=failsafe",
    noun: "Fail-safe requests",
  },
  unassigned: {
    id: "unassigned",
    kind: ticketQueue,
    href: "/staff/tickets?assignee=none",
    noun: "Unassigned tickets",
  },
  fit_holds: {
    id: "fit_holds",
    kind: fitQueue,
    href: "/staff/pipeline?tab=fit",
    noun: "Fit holds",
  },
  launch_ready: {
    id: "launch_ready",
    kind: "launch",
    href: "/staff/pipeline?tab=launch",
    noun: "Builds ready to approve",
  },
  polish: {
    id: "polish",
    kind: polishQueue,
    href: "/staff/pipeline?tab=polish",
    noun: "Polish queue",
  },
  reports_open: {
    id: "reports_open",
    kind: reportQueue,
    href: "/staff/review?tab=reports",
    noun: "Reports and DMCA cases",
  },
  ratings_down: {
    id: "ratings_down",
    kind: "rating",
    href: "/staff/tickets?tab=ratings",
    noun: "Thumbs-down ratings",
  },
  incidents_windows: {
    id: "incidents_windows",
    kind: "incident",
    href: "/staff/tickets?tab=incidents",
    noun: "Incidents and windows",
  },
  notices: {
    id: "notices",
    kind: "site",
    href: "/staff/sites?status=notice",
    noun: "Sites with a notice",
  },
  domain_moves_failed: {
    id: "domain_moves_failed",
    kind: "domain",
    href: "/staff/pipeline?tab=launch",
    noun: "Domain moves failed",
  },
  domain_post_switch: {
    id: "domain_post_switch",
    kind: "domain",
    href: "/staff/pipeline?tab=launch",
    noun: "Post-switch mismatches",
  },
  domain_expiring: {
    id: "domain_expiring",
    kind: "domain",
    href: "/staff/health",
    noun: "Domains expiring within 7 days",
  },
  domain_gate_override: {
    id: "domain_gate_override",
    kind: "domain",
    href: "/staff/pipeline?tab=launch",
    noun: "Gates waiting for an override",
  },
  domain_ns_slow: {
    id: "domain_ns_slow",
    kind: "domain",
    href: "/staff/pipeline?tab=launch",
    noun: "Sites waiting on nameservers",
  },
  sites_leaving: {
    id: "sites_leaving",
    kind: "site",
    href: "/staff/sites?status=leaving",
    noun: "Sites leaving CDS",
  },
};

/** One site: its own tab; several: the row's list link (14-45 choice 4). */
export function domainRowHref(
  id: StaffTodayRowId,
  orgIds: readonly string[],
): string {
  if (orgIds.length === 1) {
    const tab = id === "sites_leaving" ? "offboarding" : "domain";
    return `/staff/sites/${encodeURIComponent(orgIds[0]!)}?tab=${tab}`;
  }
  return ROW[id].href;
}

/** Which rows a source owns (for the failed state). */
const ROWS_OF: Record<FeederName, StaffTodayRowId[]> = {
  tickets: ["sla_missed", "sla_at_risk", "unassigned"],
  review: ["held_late"],
  reports: ["reports_open"],
  fit: ["fit_holds"],
  launch: ["launch_ready"],
  polish: ["polish"],
  incidents: ["incidents_windows"],
  ratings: ["ratings_down"],
  health: ["health_warn"],
  failsafe: ["failsafe_pending"],
  sites: ["notices"],
  domains: [
    "domain_moves_failed",
    "domain_post_switch",
    "domain_expiring",
    "domain_gate_override",
    "domain_ns_slow",
    "sites_leaving",
  ],
};

function row(
  id: StaffTodayRowId,
  count: number,
  severity: StaffTodaySeverity,
  label: string,
  oldestMs?: number,
  href?: string,
): StaffTodayRow {
  const def = ROW[id];
  return {
    id,
    kind: def.kind,
    count,
    severity,
    label,
    href: href ?? def.href,
    ...(oldestMs !== undefined ? { oldestMs } : {}),
  };
}

export type StaffTodayOptions = {
  now?: Date;
  /** `ADDON_REGISTRY.list()` from the caller (Invariant 4, P13-P7). */
  manifests?: readonly MonitorManifest[];
  /** Tests replace a source. */
  feeders?: Partial<StaffTodayFeeders>;
};

/** Sorts rows by severity, then the CONTEXT order. */
export function sortTodayRows(rows: readonly StaffTodayRow[]): StaffTodayRow[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      STAFF_TODAY_ROW_IDS.indexOf(a.id) - STAFF_TODAY_ROW_IDS.indexOf(b.id),
  );
}

/**
 * Today's needs-attention rows, the status line and the sidebar badges (`console`). Every
 * source is read with Promise.allSettled; nothing here writes.
 */
export async function staffTodayCounts(
  ctx: PlatformContext,
  opts: StaffTodayOptions = {},
): Promise<StaffTodayCounts> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const now = opts.now ?? new Date();
  const feeders: StaffTodayFeeders = {
    ...DEFAULT_TODAY_FEEDERS,
    ...opts.feeders,
  };
  const manifests = opts.manifests ?? [];
  const names = Object.keys(FEATURE) as FeederName[];
  const allowed = names.filter((n) => staffCanFeature(ctx, FEATURE[n]));

  const settled = await Promise.allSettled(
    allowed.map((name) => {
      switch (name) {
        case "health":
          return feeders.health(ctx, now, manifests);
        case "fit":
        case "launch":
        case "polish":
        case "failsafe":
          return feeders[name](ctx);
        default:
          return feeders[name](ctx, now);
      }
    }),
  );
  const got: Partial<{
    [K in FeederName]: Awaited<ReturnType<StaffTodayFeeders[K]>>;
  }> = {};
  const failed: string[] = [];
  settled.forEach((r, i) => {
    const name = allowed[i]!;
    if (r.status === "fulfilled") {
      (got as Record<string, unknown>)[name] = r.value;
    } else {
      failed.push(name);
      const err = r.reason;
      console.error(
        `[staff today] ${name} failed ${err instanceof Error ? err.name : typeof err}`,
      );
    }
  });

  const rows: StaffTodayRow[] = [];
  const t = got.tickets;
  if (t) {
    if (t.missed > 0)
      rows.push(
        row(
          "sla_missed",
          t.missed,
          "critical",
          `${t.missed} ${plural(t.missed, "ticket", "tickets")} missed SLA`,
          t.oldestMissedMs,
        ),
      );
    if (t.atRisk > 0)
      rows.push(
        row(
          "sla_at_risk",
          t.atRisk,
          "warn",
          `${t.atRisk} ${plural(t.atRisk, "ticket", "tickets")} at SLA risk`,
          t.oldestAtRiskMs,
        ),
      );
    if (t.unassigned > 0)
      rows.push(
        row(
          "unassigned",
          t.unassigned,
          "info",
          `${t.unassigned} unassigned ${plural(t.unassigned, "ticket", "tickets")}`,
          t.oldestUnassignedMs,
        ),
      );
  }
  const rv = got.review;
  if (rv && rv.heldLate > 0) {
    rows.push(
      row(
        "held_late",
        rv.heldLate,
        rv.heldDanger ? "critical" : "warn",
        `${rv.heldLate} held ${plural(rv.heldLate, "page", "pages")} past 1 business day`,
      ),
    );
  }
  const h = got.health;
  if (h) {
    if (h.critical > 0)
      rows.push(
        row(
          "health_critical",
          h.critical,
          "critical",
          `${h.critical} critical`,
        ),
      );
    if (h.warn > 0)
      rows.push(
        row(
          "health_warn",
          h.warn,
          "warn",
          `${h.warn} health ${plural(h.warn, "warning", "warnings")}`,
        ),
      );
  }
  const fs = got.failsafe;
  if (fs && fs.count > 0) {
    rows.push(
      row(
        "failsafe_pending",
        fs.count,
        "warn",
        `${fs.count} pending fail-safe ${plural(fs.count, "request", "requests")}`,
      ),
    );
  }
  const fit = got.fit;
  if (fit && fit.count > 0)
    rows.push(
      row(
        "fit_holds",
        fit.count,
        "info",
        `${fit.count} fit ${plural(fit.count, "hold", "holds")}`,
      ),
    );
  const launch = got.launch;
  if (launch && launch.count > 0)
    rows.push(
      row(
        "launch_ready",
        launch.count,
        "info",
        `${launch.count} ${plural(launch.count, "build", "builds")} ready to approve`,
      ),
    );
  const polish = got.polish;
  if (polish && polish.count > 0)
    rows.push(
      row(
        "polish",
        polish.count,
        "info",
        `${polish.count} ${plural(polish.count, "site", "sites")} in the polish queue`,
      ),
    );
  const rp = got.reports;
  if (rp && rp.open > 0)
    rows.push(
      row(
        "reports_open",
        rp.open,
        "info",
        `${rp.open} ${plural(rp.open, "report or DMCA case", "reports and DMCA cases")} open`,
      ),
    );
  const ra = got.ratings;
  if (ra && ra.count > 0)
    rows.push(
      row(
        "ratings_down",
        ra.count,
        "info",
        `${ra.count} thumbs-down ${plural(ra.count, "rating", "ratings")} to follow up`,
      ),
    );
  const inc = got.incidents;
  if (inc && inc.incidents + inc.windows > 0) {
    rows.push(
      row(
        "incidents_windows",
        inc.incidents + inc.windows,
        "info",
        `${inc.incidents} open ${plural(inc.incidents, "incident", "incidents")} · ${inc.windows} active ${plural(inc.windows, "window", "windows")}`,
        undefined,
        inc.incidents > 0
          ? "/staff/tickets?tab=incidents"
          : "/staff/tickets?tab=windows",
      ),
    );
  }
  const st = got.sites;
  if (st && st.notices > 0)
    rows.push(
      row(
        "notices",
        st.notices,
        "info",
        `${st.notices} ${plural(st.notices, "site", "sites")} with a notice to fix`,
      ),
    );

  const dm = got.domains;
  if (dm) {
    const defs: [
      StaffTodayRowId,
      readonly string[],
      StaffTodaySeverity,
      (n: number) => string,
    ][] = [
      [
        "domain_moves_failed",
        dm.movesFailed,
        "critical",
        (n) => `${n} domain ${plural(n, "move", "moves")} failed`,
      ],
      [
        "domain_post_switch",
        dm.postSwitch,
        "critical",
        (n) => `${n} post-switch ${plural(n, "mismatch", "mismatches")}`,
      ],
      [
        "domain_expiring",
        dm.expiring7d,
        "critical",
        (n) =>
          `${n} ${plural(n, "domain expires", "domains expire")} within 7 days`,
      ],
      [
        "domain_gate_override",
        dm.gatePending,
        "warn",
        (n) => `${n} ${plural(n, "gate", "gates")} waiting for an override`,
      ],
      [
        "domain_ns_slow",
        dm.waitingNs,
        "warn",
        (n) =>
          `${n} ${plural(n, "site", "sites")} waiting on nameservers over 48 h`,
      ],
      [
        "sites_leaving",
        dm.leaving,
        "info",
        (n) => `${n} ${plural(n, "site", "sites")} leaving CDS`,
      ],
    ];
    for (const [id, orgIds, severity, label] of defs) {
      if (orgIds.length === 0) continue;
      rows.push(
        row(
          id,
          orgIds.length,
          severity,
          label(orgIds.length),
          undefined,
          domainRowHref(id, orgIds),
        ),
      );
    }
  }

  // A failed source: its rows read "Couldn't count" (count null), after the real rows.
  for (const name of failed as FeederName[]) {
    for (const id of ROWS_OF[name]) {
      const def = ROW[id];
      rows.push({
        id,
        kind: def.kind,
        count: null,
        severity: "info",
        label: def.noun,
        href: def.href,
      });
    }
  }

  const sum = (...xs: (number | undefined)[]): number | null =>
    xs.some((x) => x === undefined)
      ? null
      : xs.reduce<number>((a, x) => a + (x ?? 0), 0);
  const badges: StaffTodayBadges = {
    tickets: t ? t.missed + t.atRisk + t.unassigned : null,
    pipeline: sum(fit?.count, launch?.count),
    review: sum(rv?.held, rp?.open),
    health: sum(h ? h.critical + h.warn : undefined, fs?.count),
  };
  return {
    rows: sortTodayRows(rows),
    status: {
      live: st ? st.live : null,
      building: st ? st.building : null,
      openTickets: t ? t.open : null,
      jobsLate: h ? h.jobsLate : null,
    },
    badges,
    failed,
  };
}

/** Days for the "oldest 2d" label (rounded down, min 0). */
export function todayAgeDays(ms: number | undefined): number | null {
  return ms === undefined ? null : Math.max(0, Math.floor(ms / DAY_MS));
}
