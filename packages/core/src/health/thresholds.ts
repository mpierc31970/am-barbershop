// Health thresholds (13-40; STAFF-13, STAFF-16, D174, D175, D290). The one place the monitor
// brief §3 thresholds live: GET /api/monitor/status (overall), the health job (13-44, one
// incident per check, P13-P19) and the console Health view (13-45) all evaluate these.
// Pure: no I/O, `now` is injected. Rows whose brief condition needs history ("for 3 runs in a
// row", "grew since the last check") are evaluated on the current value at the lower level;
// escalation over time is the monitor app's job (D174).
//
// `MonitorStatusDoc` is the §4 shape the platform emits (`monitorStatus()` in @cds/db). A
// section is null when its feeder failed (P13-P28).

export type MonitorJobBase = { last_success: string | null };

export type MonitorStatusDoc = {
  generated_at: string;
  version: string;
  overall: "ok" | "degraded" | "down";
  components: {
    id: string;
    status: "ok" | "down" | "off" | "stand_in";
    latency_ms?: number;
    mode?: string;
  }[];
  tenants:
    | {
        org_id: string;
        name: string;
        live_domain: string | null;
        preview_host: string | null;
        live: boolean;
        suspended: boolean;
        premium: string[];
        demo: boolean;
      }[]
    | null;
  premium:
    | {
        org_id: string;
        addon: string;
        status: "ok" | "unknown" | "unhealthy";
        checks: string[];
        error_rate_1h: number | null;
        db_write_p95_ms: number | null;
        failed_emails_1h: number | null;
      }[]
    | null;
  failsafe: {
    active: boolean;
    pending_requests: number;
    deployed: boolean;
    last_pull: string | null;
  } | null;
  backups: {
    db_last_success: string | null;
    tenant_exports_last_success: string | null;
    restore_rehearsed_at: string | null;
  } | null;
  email: {
    bounce_rate_7d: number | null;
    complaint_rate_7d: number | null;
    sending_enabled: boolean;
    transport_failures_24h: number;
  } | null;
  jobs: {
    quotes: (MonitorJobBase & { send_failures_24h: number }) | null;
    media:
      (MonitorJobBase & { failed_steps: string[]; gc_errors: number }) | null;
    assembly: (MonitorJobBase & { failed_orgs: number }) | null;
    retention:
      | (MonitorJobBase & { cap_hit: boolean; overdue_closed_orgs: number })
      | null;
    billing:
      | (MonitorJobBase & {
          backlog: number;
          failed_events: number;
          restricted_accounts: number;
          payments_mode: string;
        })
      | null;
    alerts:
      | (MonitorJobBase & {
          push_failed: number;
          digest_failures: number;
          held_quiet: number;
        })
      | null;
    reports:
      | (MonitorJobBase & {
          month: string | null;
          emails_sent: number;
          send_failures: number;
          failed_orgs: number;
        })
      | null;
    support:
      | (MonitorJobBase & {
          failed_steps: string[];
          sla_missed_open: number;
          open_windows: { code: string; active_hours: number }[];
        })
      | null;
    review:
      | (MonitorJobBase & {
          failed_steps: string[];
          queued_scans: number;
          held_oldest_business_days: number;
        })
      | null;
    health:
      | (MonitorJobBase & { failed_steps: string[]; open_incidents: number })
      | null;
    indexing: (MonitorJobBase & { failed_steps: string[] }) | null;
    demo: MonitorJobBase | null;
    domains: (MonitorJobBase & { failed_steps: string[] }) | null;
  };
  payments: { failed_webhooks_1h: number } | null;
  service_mode: {
    active: boolean;
    scope: string | null;
    windows: number;
  } | null;
  growth: unknown[];
  indexing: {
    last_weekly_resubmit: string | null;
    indexnow_failures_24h: number;
    sitemap_errors: number;
    sitemap_submit_errors: number;
  } | null;
  domains: MonitorDomains | null;
  review: {
    text_checker: MonitorProvider;
    image_moderator: MonitorProvider;
    link_checker: MonitorProvider;
    held_pages: number;
    held_oldest_business_days: number;
    queued_scans: number;
    webrisk_month_lookups: number;
    webrisk_cap: number;
  } | null;
  chatbot: null;
  media: {
    cdn: string;
    cdn_status: "ok" | "down";
    fallback_active: boolean;
    origin_errors_1h: number;
    compress_failures_24h: number;
    fallback_since: string | null;
    video_paused: boolean;
    stuck_videos: number;
    over_allowance: number;
    wasabi_egress_month_gb: number | null;
    wasabi_stored_gb: number | null;
    over_delivery: {
      org_id: string;
      delivered_month_gb: number;
      stored_gb: number;
    }[];
  } | null;
  forms: {
    scanner: string;
    scanner_status: "off" | "ok" | "down";
    notify_failures_24h: number;
  } | null;
  beacon: {
    last_flush: string | null;
    dropped: number;
    dropped_at: string | null;
  } | null;
  /** §4 `hub` (P15 15-08, check 51, P15-P8): counts and a day age only, never claim text. */
  hub: MonitorHub | null;
};

/** §4 `hub` (P15-P8): competitor-claim freshness, computed from the static `CLAIMS`. */
export type MonitorHub = {
  claims_verified: number;
  claims_draft: number;
  /** Whole days since the oldest verified claim was checked; null when none is verified. */
  oldest_verified_days: number | null;
};

/** §4 `domains` (P14, brief checks 41, 43, 44, 46, 47, 48, 50): counts and ISO times only. */
export type MonitorDomains = {
  provider: string;
  provider_errors_24h: number;
  zones_active: number;
  custom_hosts: number;
  edge_routes: number;
  moves_open: number;
  moves_failed: number;
  moves_prepared: number;
  waiting_ns_over_48h: number;
  gate_overrides_pending: number;
  post_switch_mismatches: number;
  https_failing: number;
  cert_min_days: number | null;
  delegation_lost: number;
  email_drift: number;
  expiring_30d: number;
  expiring_7d: number;
  offboardings_in_notice: number;
  handbacks_open: number;
  sending_pending: number;
  sending_failed: number;
  last_health_at: string | null;
};

/** Every `domains.*` key, in §4 order (one place for the allowlist and the feeder test). */
export const MONITOR_DOMAINS_KEYS = [
  "provider",
  "provider_errors_24h",
  "zones_active",
  "custom_hosts",
  "edge_routes",
  "moves_open",
  "moves_failed",
  "moves_prepared",
  "waiting_ns_over_48h",
  "gate_overrides_pending",
  "post_switch_mismatches",
  "https_failing",
  "cert_min_days",
  "delegation_lost",
  "email_drift",
  "expiring_30d",
  "expiring_7d",
  "offboardings_in_notice",
  "handbacks_open",
  "sending_pending",
  "sending_failed",
  "last_health_at",
] as const satisfies readonly (keyof MonitorDomains)[];

/**
 * Every key path GET /api/monitor/status may emit (T-13-40-01), mirroring brief §4. Arrays
 * are written `[]`. A leaf path is allowed when it equals an entry or is a prefix of one
 * (a null section, an empty array). `@cds/db` re-exports it as MONITOR_STATUS_ALLOWLIST.
 */
export const MONITOR_STATUS_PATHS: readonly string[] = [
  "generated_at",
  "version",
  "overall",
  "components[].id",
  "components[].status",
  "components[].latency_ms",
  "components[].mode",
  "tenants[].org_id",
  "tenants[].name",
  "tenants[].live_domain",
  "tenants[].preview_host",
  "tenants[].live",
  "tenants[].suspended",
  "tenants[].premium[]",
  "tenants[].demo",
  "premium[].org_id",
  "premium[].addon",
  "premium[].status",
  "premium[].checks[]",
  "premium[].error_rate_1h",
  "premium[].db_write_p95_ms",
  "premium[].failed_emails_1h",
  "failsafe.active",
  "failsafe.pending_requests",
  "failsafe.deployed",
  "failsafe.last_pull",
  "backups.db_last_success",
  "backups.tenant_exports_last_success",
  "backups.restore_rehearsed_at",
  "email.bounce_rate_7d",
  "email.complaint_rate_7d",
  "email.sending_enabled",
  "email.transport_failures_24h",
  "jobs.quotes.last_success",
  "jobs.quotes.send_failures_24h",
  "jobs.media.last_success",
  "jobs.media.failed_steps[]",
  "jobs.media.gc_errors",
  "jobs.assembly.last_success",
  "jobs.assembly.failed_orgs",
  "jobs.retention.last_success",
  "jobs.retention.cap_hit",
  "jobs.retention.overdue_closed_orgs",
  "jobs.billing.last_success",
  "jobs.billing.backlog",
  "jobs.billing.failed_events",
  "jobs.billing.restricted_accounts",
  "jobs.billing.payments_mode",
  "jobs.alerts.last_success",
  "jobs.alerts.push_failed",
  "jobs.alerts.digest_failures",
  "jobs.alerts.held_quiet",
  "jobs.reports.last_success",
  "jobs.reports.month",
  "jobs.reports.emails_sent",
  "jobs.reports.send_failures",
  "jobs.reports.failed_orgs",
  "jobs.support.last_success",
  "jobs.support.failed_steps[]",
  "jobs.support.sla_missed_open",
  "jobs.support.open_windows[].code",
  "jobs.support.open_windows[].active_hours",
  "jobs.review.last_success",
  "jobs.review.failed_steps[]",
  "jobs.review.queued_scans",
  "jobs.review.held_oldest_business_days",
  "jobs.health.last_success",
  "jobs.health.failed_steps[]",
  "jobs.health.open_incidents",
  "jobs.indexing.last_success",
  "jobs.indexing.failed_steps[]",
  "jobs.demo.last_success",
  "jobs.domains.last_success",
  "jobs.domains.failed_steps[]",
  "payments.failed_webhooks_1h",
  "service_mode.active",
  "service_mode.scope",
  "service_mode.windows",
  "growth[]",
  "indexing.last_weekly_resubmit",
  "indexing.indexnow_failures_24h",
  "indexing.sitemap_errors",
  "indexing.sitemap_submit_errors",
  "domains.provider",
  "domains.provider_errors_24h",
  "domains.zones_active",
  "domains.custom_hosts",
  "domains.edge_routes",
  "domains.moves_open",
  "domains.moves_failed",
  "domains.moves_prepared",
  "domains.waiting_ns_over_48h",
  "domains.gate_overrides_pending",
  "domains.post_switch_mismatches",
  "domains.https_failing",
  "domains.cert_min_days",
  "domains.delegation_lost",
  "domains.email_drift",
  "domains.expiring_30d",
  "domains.expiring_7d",
  "domains.offboardings_in_notice",
  "domains.handbacks_open",
  "domains.sending_pending",
  "domains.sending_failed",
  "domains.last_health_at",
  "review.text_checker.provider",
  "review.text_checker.status",
  "review.image_moderator.provider",
  "review.image_moderator.status",
  "review.link_checker.provider",
  "review.link_checker.status",
  "review.held_pages",
  "review.held_oldest_business_days",
  "review.queued_scans",
  "review.webrisk_month_lookups",
  "review.webrisk_cap",
  "chatbot",
  "media.cdn",
  "media.cdn_status",
  "media.fallback_active",
  "media.origin_errors_1h",
  "media.compress_failures_24h",
  "media.fallback_since",
  "media.video_paused",
  "media.stuck_videos",
  "media.over_allowance",
  "media.wasabi_egress_month_gb",
  "media.wasabi_stored_gb",
  "media.over_delivery[].org_id",
  "media.over_delivery[].delivered_month_gb",
  "media.over_delivery[].stored_gb",
  "forms.scanner",
  "forms.scanner_status",
  "forms.notify_failures_24h",
  "beacon.last_flush",
  "beacon.dropped",
  "beacon.dropped_at",
  "hub.claims_verified",
  "hub.claims_draft",
  "hub.oldest_verified_days",
];

/** Leaf key paths of a JSON value (`a.b`, arrays as `[]`; null / empty containers are leaves). */
export function monitorKeyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    const here = `${prefix}[]`;
    if (value.length === 0) return [here];
    return value.flatMap((v) => monitorKeyPaths(v, here));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [prefix];
    return entries.flatMap(([k, v]) =>
      monitorKeyPaths(v, prefix === "" ? k : `${prefix}.${k}`),
    );
  }
  return [prefix];
}

/** True when `path` is an allowlisted path or a boundary prefix of one. */
export function isAllowedMonitorPath(path: string): boolean {
  return MONITOR_STATUS_PATHS.some(
    (p) => p === path || p.startsWith(`${path}.`) || p.startsWith(`${path}[]`),
  );
}

export type MonitorProvider = {
  provider: string;
  status: "ok" | "skipped" | "error" | "capped";
};

export type HealthLevel = "ok" | "warn" | "critical" | "none";

export type HealthCheck<V = unknown> = {
  /** Stable id (platform_meta `health:incident:<id>`, P13-P19). */
  id: string;
  /** Row number in MONITOR-APP-BRIEF.md §3. */
  brief: number;
  label: string;
  /** The value to judge; null/undefined = nothing to judge (level "none"). */
  source: (status: MonitorStatusDoc) => V | null | undefined;
  warning: (value: V, now: Date) => boolean;
  critical: (value: V, now: Date) => boolean;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Milliseconds since an ISO time; Infinity when unparseable (treated as very old). */
export function ageMs(iso: string | null | undefined, now: Date): number {
  if (typeof iso !== "string" || iso === "") return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso.replace(" ", "T"));
  return Number.isFinite(t) ? now.getTime() - t : Number.POSITIVE_INFINITY;
}

const olderThan = (iso: string | null, ms: number, now: Date): boolean =>
  ageMs(iso, now) > ms;

const never = (): boolean => false;

function check<V>(c: HealthCheck<V>): HealthCheck {
  return c as unknown as HealthCheck;
}

/** True once any non-demo site is live: the platform is in real use (WR-B03). */
export function platformLaunched(s: MonitorStatusDoc): boolean {
  return (s.tenants ?? []).some((t) => t.live && !t.demo);
}

/**
 * WR-B03: a job that has never succeeded has nothing to judge only before launch (dev,
 * pre-launch quiet). Once a non-demo site is live, `last_success: null` is judged as very
 * old (`olderThan(null)` is Infinity), so a scheduled task that was never created, or that
 * fails from its first run, warns instead of staying silent.
 */
function job<J extends MonitorJobBase>(
  s: MonitorStatusDoc,
  j: J | null | undefined,
): J | null {
  if (!j) return null;
  return j.last_success || platformLaunched(s) ? j : null;
}

export const HEALTH_CHECKS: readonly HealthCheck[] = [
  check({
    id: "failsafe",
    brief: 8,
    label: "Fail-safe capture",
    source: (s) => s.failsafe,
    critical: (v) => v.active,
    warning: (v) => v.pending_requests > 0,
  }),
  check({
    id: "media-cdn",
    brief: 17,
    label: "Media CDN and video",
    source: (s) => s.media,
    critical: (v) => v.video_paused || v.origin_errors_1h > 0,
    warning: (v) =>
      v.fallback_active ||
      v.stuck_videos > 0 ||
      v.compress_failures_24h > 0 ||
      v.over_allowance > 0,
  }),
  check({
    id: "job-quotes",
    brief: 19,
    label: "Quote reminder job",
    source: (s) => job(s, s.jobs.quotes),
    critical: never,
    warning: (v, now) =>
      olderThan(v.last_success, 3 * HOUR, now) || v.send_failures_24h > 0,
  }),
  check({
    id: "email-transport",
    brief: 20,
    label: "Email sending",
    source: (s) => s.email,
    critical: (v) => !v.sending_enabled,
    warning: (v) => v.transport_failures_24h > 0,
  }),
  check({
    id: "forms-scanner",
    brief: 22,
    label: "Virus scanner for uploads",
    source: (s) => s.forms,
    critical: never,
    warning: (v) =>
      (v.scanner === "clamd" && v.scanner_status === "down") ||
      v.notify_failures_24h > 0,
  }),
  check({
    id: "media-compress",
    brief: 23,
    label: "Video compression",
    source: (s) => s.media,
    critical: never,
    warning: (v) => v.stuck_videos > 0 || v.compress_failures_24h > 0,
  }),
  check({
    id: "job-media",
    brief: 24,
    label: "Media job",
    source: (s) => job(s, s.jobs.media),
    critical: never,
    warning: (v, now) =>
      olderThan(v.last_success, 3 * HOUR, now) ||
      v.failed_steps.length > 0 ||
      v.gc_errors > 0,
  }),
  check({
    id: "job-assembly",
    brief: 25,
    label: "Assembly job",
    // Failed orgs are critical even before a first clean run; staleness goes through job().
    source: (s) =>
      s.jobs.assembly && s.jobs.assembly.failed_orgs > 0
        ? s.jobs.assembly
        : job(s, s.jobs.assembly),
    critical: (v) => v.failed_orgs > 0,
    warning: (v, now) => olderThan(v.last_success, 3 * HOUR, now),
  }),
  check({
    id: "job-retention",
    brief: 26,
    label: "Retention job",
    source: (s) => job(s, s.jobs.retention),
    critical: never,
    warning: (v, now) =>
      olderThan(v.last_success, 36 * HOUR, now) ||
      v.cap_hit ||
      v.overdue_closed_orgs > 0,
  }),
  check({
    id: "job-billing",
    brief: 27,
    label: "Billing reconcile job",
    source: (s) => job(s, s.jobs.billing),
    critical: never,
    warning: (v, now) =>
      olderThan(v.last_success, 3 * HOUR, now) ||
      v.backlog > 0 ||
      v.failed_events > 0 ||
      v.restricted_accounts > 0,
  }),
  check({
    id: "beacon",
    brief: 29,
    label: "Site metrics beacon",
    // WR-B03: a beacon that never flushed is judged once a non-demo site is live.
    source: (s) =>
      s.beacon && (s.beacon.last_flush !== null || platformLaunched(s))
        ? {
            ...s.beacon,
            anyLive: (s.tenants ?? []).some((t) => t.live && !t.demo),
          }
        : null,
    critical: never,
    warning: (v, now) =>
      (v.anyLive && olderThan(v.last_flush, 10 * MIN, now)) ||
      (v.dropped_at !== null && !olderThan(v.dropped_at, HOUR, now)),
  }),
  check({
    id: "job-alerts",
    brief: 30,
    label: "Alert job",
    source: (s) => job(s, s.jobs.alerts),
    critical: (v, now) => olderThan(v.last_success, 60 * MIN, now),
    warning: (v, now) =>
      olderThan(v.last_success, 15 * MIN, now) || v.digest_failures > 0,
  }),
  check({
    id: "job-reports",
    brief: 31,
    label: "Monthly report job",
    source: (s) => job(s, s.jobs.reports),
    critical: (v, now) => olderThan(v.last_success, 3 * DAY, now),
    warning: (v, now) =>
      olderThan(v.last_success, 36 * HOUR, now) ||
      v.failed_orgs > 0 ||
      v.send_failures > 0,
  }),
  check({
    id: "job-support",
    brief: 32,
    label: "Support job",
    source: (s) => job(s, s.jobs.support),
    critical: (v, now) =>
      olderThan(v.last_success, 4 * HOUR, now) ||
      v.open_windows.some((w) => w.active_hours > 24),
    warning: (v, now) =>
      olderThan(v.last_success, 2 * HOUR, now) ||
      v.sla_missed_open > 0 ||
      v.failed_steps.length > 0,
  }),
  check({
    id: "job-review",
    brief: 33,
    label: "Review job",
    source: (s) => job(s, s.jobs.review),
    critical: (v, now) => olderThan(v.last_success, 4 * HOUR, now),
    warning: (v, now) =>
      olderThan(v.last_success, 2 * HOUR, now) ||
      v.failed_steps.length > 0 ||
      v.queued_scans > 0,
  }),
  check({
    id: "job-health",
    brief: 34,
    label: "Health job",
    source: (s) => job(s, s.jobs.health),
    critical: (v, now) => olderThan(v.last_success, 30 * MIN, now),
    warning: (v, now) =>
      olderThan(v.last_success, 15 * MIN, now) || v.failed_steps.length > 0,
  }),
  check({
    id: "job-indexing",
    brief: 35,
    label: "Indexing job",
    source: (s) => {
      const j = job(s, s.jobs.indexing);
      return j
        ? { ...j, sitemap_errors: s.indexing?.sitemap_errors ?? 0 }
        : null;
    },
    critical: never,
    warning: (v, now) =>
      olderThan(v.last_success, 8 * DAY, now) ||
      v.failed_steps.length > 0 ||
      v.sitemap_errors > 0,
  }),
  check({
    id: "job-demo",
    brief: 36,
    label: "Demo reset job",
    source: (s) => job(s, s.jobs.demo),
    critical: never,
    warning: (v, now) => olderThan(v.last_success, 30 * HOUR, now),
  }),
  check({
    id: "review-scanners",
    brief: 37,
    label: "Content scanners and held pages",
    source: (s) => s.review,
    critical: (v) => v.held_oldest_business_days > 2,
    warning: (v) =>
      v.queued_scans > 0 ||
      [v.text_checker, v.image_moderator, v.link_checker].some(
        (p) => p.status === "error" || p.status === "capped",
      ),
  }),
  check({
    id: "restore-rehearsal",
    brief: 40,
    label: "Restore rehearsal",
    source: (s) => s.backups,
    critical: never,
    warning: (v, now) => olderThan(v.restore_rehearsed_at, 90 * DAY, now),
  }),
  // P14 (14-45): brief rows 41-50. Row 41's critical (errors on every run for 1 h) and row 47's
  // critical (failed for 2 runs in a row, an open handback mismatch alert) need history: judged
  // at warning on the current value; escalation is the monitor app's (D174). Row 48 (the
  // monitor polls /api/edge/routes itself), row 49 (seen through row 42) and row 50's
  // "pending > 72 h" (no age in the contract) are left to the monitor app.
  check({
    id: "domains-provider",
    brief: 41,
    label: "DNS provider (Cloudflare)",
    source: (s) => s.domains,
    critical: never,
    warning: (v) => v.provider_errors_24h > 0,
  }),
  check({
    id: "job-domains",
    brief: 42,
    label: "Domains job",
    source: (s) => job(s, s.jobs.domains),
    critical: (v, now) => olderThan(v.last_success, 30 * MIN, now),
    warning: (v, now) =>
      olderThan(v.last_success, 15 * MIN, now) || v.failed_steps.length > 0,
  }),
  check({
    id: "domains-https",
    brief: 43,
    label: "Custom-domain HTTPS and certificates",
    source: (s) => s.domains,
    critical: (v) =>
      v.https_failing > 0 || (v.cert_min_days !== null && v.cert_min_days < 7),
    warning: (v) => v.cert_min_days !== null && v.cert_min_days < 21,
  }),
  check({
    id: "domains-drift",
    brief: 44,
    label: "Delegation and email records",
    source: (s) => s.domains,
    critical: (v) =>
      v.delegation_lost > 0 ||
      v.email_drift > 0 ||
      v.post_switch_mismatches > 0,
    warning: never,
  }),
  check({
    id: "indexing-submit",
    brief: 45,
    label: "IndexNow and sitemap submission",
    source: (s) => s.indexing,
    critical: never,
    warning: (v) => v.indexnow_failures_24h > 0 || v.sitemap_submit_errors > 0,
  }),
  check({
    id: "domains-expiry",
    brief: 46,
    label: "Domain expiry",
    source: (s) => s.domains,
    critical: (v) => v.expiring_7d > 0,
    warning: (v) => v.expiring_30d > 0,
  }),
  check({
    id: "domains-moves",
    brief: 47,
    label: "Domain moves and offboardings",
    source: (s) => s.domains,
    critical: never,
    warning: (v) =>
      v.moves_failed > 0 ||
      v.waiting_ns_over_48h > 0 ||
      v.gate_overrides_pending > 0,
  }),
  check({
    id: "domains-sending",
    brief: 50,
    label: "Own-domain email sending",
    source: (s) => s.domains,
    critical: never,
    warning: (v) => v.sending_failed > 0,
  }),
  // P15 (15-08, P15-P8, A2-Q5): competitor claims are re-verified every 6 months. No verified
  // claim (oldest_verified_days null) is ok, so drafts never alarm.
  check({
    id: "hub-claims",
    brief: 51,
    label: "Hub competitor claims",
    source: (s) => s.hub,
    warning: (v) => (v.oldest_verified_days ?? 0) > 150,
    critical: (v) => (v.oldest_verified_days ?? 0) > 183,
  }),
];

/** One check against one status document. */
export function evaluateCheck(
  c: HealthCheck,
  status: MonitorStatusDoc,
  now: Date,
): HealthLevel {
  let value: unknown;
  try {
    value = c.source(status);
  } catch {
    return "none";
  }
  if (value === null || value === undefined) return "none";
  if (c.critical(value, now)) return "critical";
  if (c.warning(value, now)) return "warn";
  return "ok";
}

const RANK: Record<HealthLevel, number> = {
  none: 0,
  ok: 1,
  warn: 2,
  critical: 3,
};

/** The worst of several levels ("none" when the list is empty or all "none"). */
export function levelFor(levels: readonly HealthLevel[]): HealthLevel {
  let worst: HealthLevel = "none";
  for (const l of levels) if (RANK[l] > RANK[worst]) worst = l;
  return worst;
}

export type HealthEvaluation = {
  id: string;
  brief: number;
  label: string;
  level: HealthLevel;
};

/** Every HEALTH_CHECKS entry against one status document, in brief order. */
export function evaluateAll(
  status: MonitorStatusDoc,
  now: Date,
): HealthEvaluation[] {
  return HEALTH_CHECKS.map((c) => ({
    id: c.id,
    brief: c.brief,
    label: c.label,
    level: evaluateCheck(c, status, now),
  }));
}
