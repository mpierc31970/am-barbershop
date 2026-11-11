// packages/db/src/staff/health.ts: filled by 13-44 (health view + checks)
//
// Health view data and the incident evaluation behind `health:run` (STAFF-13, STAFF-14, D154,
// D174; P13-P19). Both are built from ONE source: `monitorStatus()` (13-40) plus the shared
// `HEALTH_CHECKS` thresholds in `@cds/core/health`, so the console Health view (13-45), the
// monitor endpoint and the 5-minute staff alert email can never disagree.
//
// - staffHealthView(ctx, { now, manifests }): staff read (`health` feature). Components,
//   backups, restore rehearsal (warn > 90 days), every job heartbeat with its warning/critical
//   text and level, premium rows per (org, premium add-on) from the caller's manifests (empty
//   in v1.0), fail-safe status, and every check with the "since" of its open incident.
//   Stand-ins are rows with level `none` and "(stand-in)" in the reading, never errors
//   (D-UI-P13-22).
// - jobEvaluateHealth(now, deps): one incident per check, state in platform_meta
//   `health:incident:<checkId>` = JSON `{ level, opened_at }`. ok/none -> warn|critical opens
//   it and sends one `staff.health_alert`; warn -> critical sends once more; -> ok deletes the
//   key and sends one "Resolved" email with the duration. `none` (nothing to judge, e.g. a
//   feeder failed) never opens or closes. The demo org never triggers anything: monitorStatus
//   keeps it out of premium[] and of the beacon's "any site live" (D293).
//   Mail goes to `staffAlertAddress()` (CDS_STAFF_ALERT_EMAIL, else CDS_SUPPORT_EMAIL); none
//   set = skipped + logged, the incident is still recorded. A send that throws leaves the key
//   unchanged so the next run retries. Mail carries the check label, level, reading and
//   threshold only: counts and ages, never a tenant name, host or email (T-13-44-03).
import { authorizeStaff } from "@cds/core";
import {
  ageMs,
  evaluateAll,
  HEALTH_CHECKS,
  type HealthLevel,
  type MonitorStatusDoc,
} from "@cds/core/health";
import { maskEmail } from "@cds/core/staff";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../client";
import {
  assertPlatformContext,
  mintSystemContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { platformUrl } from "../email/env";
import type { EmailData } from "../email/render/templates";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress } from "../media/ops/alerts";
import { writePlatformMeta } from "../platform-meta";
import {
  monitorStatus,
  type MonitorFeeders,
  type MonitorManifest,
} from "./monitor-status";

export const HEALTH_INCIDENT_PREFIX = "health:incident:";
export const HEALTH_ALERT_HREF = "/staff/health?tab=jobs";
/** Restore rehearsal older than this is a warning (brief row 40). */
export const RESTORE_WARN_DAYS = 90;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ------------------------------------------------------------------ threshold text (brief §3)
/** Warning / critical wording per check, from MONITOR-APP-BRIEF.md §3. */
export const HEALTH_THRESHOLD_TEXT: Readonly<
  Record<string, { warning: string; critical: string | null }>
> = {
  failsafe: {
    warning: "requests waiting to be converted",
    critical: "capture active (a booking system is down)",
  },
  "media-cdn": {
    warning:
      "fallback active, stuck or failed videos, or a site over its allowance",
    critical: "CDN origin errors, or video paused",
  },
  "job-quotes": { warning: "> 3 h, or send failures", critical: null },
  "email-transport": {
    warning: "any failure in 24 h",
    critical: "sending disabled",
  },
  "forms-scanner": {
    warning: "clamd down, or notification failures",
    critical: null,
  },
  "media-compress": { warning: "stuck or failed videos", critical: null },
  "job-media": { warning: "> 3 h, failed steps or GC errors", critical: null },
  "job-assembly": {
    warning: "> 3 h",
    critical: "a site failed to assemble",
  },
  "job-retention": {
    warning: "> 36 h, cap hit or a closed site overdue",
    critical: null,
  },
  "job-billing": {
    warning: "> 3 h, backlog, failed events or a restricted account",
    critical: null,
  },
  beacon: {
    warning: "no flush for 10 min while a site is live, or rows dropped in 1 h",
    critical: null,
  },
  "job-alerts": {
    warning: "> 15 min, or digest failures",
    critical: "> 60 min",
  },
  "job-reports": {
    warning: "> 36 h, failed sites or send failures",
    critical: "> 3 days",
  },
  "job-support": {
    warning: "> 2 h, SLA missed or failed steps",
    critical: "> 4 h, or a service window open > 24 h",
  },
  "job-review": {
    warning: "> 2 h, failed steps or queued scans",
    critical: "> 4 h",
  },
  "job-health": { warning: "> 15 min, or failed steps", critical: "> 30 min" },
  "job-indexing": {
    warning: "> 8 days, failed steps or sitemap errors",
    critical: null,
  },
  "job-demo": { warning: "> 30 h", critical: null },
  "review-scanners": {
    warning: "queued scans, or a scanner in error or capped",
    critical: "a held page waiting > 2 business days",
  },
  "restore-rehearsal": {
    warning: `> ${RESTORE_WARN_DAYS} days, or never`,
    critical: null,
  },
  // P14 (14-45): brief rows 41-50.
  "domains-provider": {
    warning: "any DNS provider error in 24 h",
    critical: null,
  },
  "job-domains": { warning: "> 15 min, or failed steps", critical: "> 30 min" },
  "domains-https": {
    warning: "a certificate with < 21 days left",
    critical: "a custom domain failing HTTPS, or < 7 days left",
  },
  "domains-drift": {
    warning: "—",
    critical:
      "delegation lost, email records drifted, or a post-switch mismatch",
  },
  "indexing-submit": {
    warning: "an IndexNow failure in 24 h, or a sitemap submission error",
    critical: null,
  },
  "domains-expiry": {
    warning: "a domain expires within 30 days",
    critical: "a domain expires within 7 days",
  },
  "domains-moves": {
    warning:
      "a failed move, nameservers unchanged > 48 h, or a gate override waiting",
    critical: null,
  },
  "domains-sending": {
    warning: "an own-domain sending identity failed",
    critical: null,
  },
  // P15 (15-08): brief row 51.
  "hub-claims": {
    warning:
      "a competitor claim on the hub was last checked over 5 months ago (150 days): re-check it, see docs/how-to/staff-hub-claims.md",
    critical:
      "a competitor claim on the hub was last checked over 6 months ago (183 days): re-check it, see docs/how-to/staff-hub-claims.md",
  },
};

/** "warn > 2 h, SLA missed · critical > 4 h" (one line, for the Threshold column and mail). */
export function healthThresholdText(checkId: string): string {
  const t = HEALTH_THRESHOLD_TEXT[checkId];
  if (!t) return "";
  return t.critical
    ? `warn ${t.warning} · critical ${t.critical}`
    : `warn ${t.warning}`;
}

// ------------------------------------------------------------------ formatting
/** "just now", "4 min ago", "5 h ago", "3 days ago"; "never" for null. */
export function healthAgo(iso: string | null | undefined, now: Date): string {
  if (!iso) return "never";
  const ms = ageMs(iso, now);
  if (!Number.isFinite(ms)) return "never";
  return `${healthDuration(ms)} ago`.replace(/^under 1 min ago$/, "just now");
}

/** "under 1 min", "12 min", "1 h 20 min", "3 days". */
export function healthDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / MIN));
  if (m < 1) return "under 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) {
    const rest = m % 60;
    return rest > 0 ? `${h} h ${rest} min` : `${h} h`;
  }
  return `${Math.floor(h / 24)} days`;
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ jobs
type JobKey = keyof MonitorStatusDoc["jobs"];

/** Job checks: the §4 job, how it is run, and its schedule (Jobs tab). */
export const HEALTH_JOBS: readonly {
  checkId: string;
  job: JobKey;
  name: string;
  schedule: string;
}[] = [
  {
    checkId: "job-alerts",
    job: "alerts",
    name: "alerts:run",
    schedule: "every 5 min",
  },
  {
    checkId: "job-health",
    job: "health",
    name: "health:run",
    schedule: "every 5 min",
  },
  {
    checkId: "job-quotes",
    job: "quotes",
    name: "quotes:run",
    schedule: "hourly",
  },
  { checkId: "job-media", job: "media", name: "media job", schedule: "hourly" },
  {
    checkId: "job-assembly",
    job: "assembly",
    name: "assembly job",
    schedule: "hourly",
  },
  {
    checkId: "job-billing",
    job: "billing",
    name: "billing:reconcile",
    schedule: "hourly",
  },
  {
    checkId: "job-support",
    job: "support",
    name: "support:run",
    schedule: "hourly",
  },
  {
    checkId: "job-review",
    job: "review",
    name: "review:run",
    schedule: "hourly",
  },
  {
    checkId: "job-demo",
    job: "demo",
    name: "demo:reset",
    schedule: "hourly (resets 3 am Central)",
  },
  {
    checkId: "job-retention",
    job: "retention",
    name: "retention:run",
    schedule: "daily",
  },
  {
    checkId: "job-reports",
    job: "reports",
    name: "reports:monthly",
    schedule: "daily",
  },
  {
    checkId: "job-indexing",
    job: "indexing",
    name: "indexing:run",
    schedule: "Sundays 6:00 am UTC",
  },
  {
    checkId: "job-domains",
    job: "domains",
    name: "domains:run",
    schedule: "every 5 min",
  },
];

function jobReading(doc: MonitorStatusDoc, job: JobKey, now: Date): string {
  const j = doc.jobs[job] as
    ({ last_success: string | null } & Record<string, unknown>) | null;
  if (!j) return "No reading";
  const parts = [
    j.last_success
      ? `Last success ${healthAgo(j.last_success, now)}`
      : "Not run yet",
  ];
  const failed = Array.isArray(j.failed_steps) ? j.failed_steps.length : 0;
  if (failed > 0) parts.push(plural(failed, "failed step"));
  return parts.join(" · ");
}

// ------------------------------------------------------------------ readings
/** Short reading per check: counts and ages only (T-13-44-03). */
export function healthReading(
  checkId: string,
  doc: MonitorStatusDoc,
  now: Date,
): string {
  const job = HEALTH_JOBS.find((j) => j.checkId === checkId);
  if (job) {
    const base = jobReading(doc, job.job, now);
    const extra: string[] = [];
    const jobs = doc.jobs;
    if (checkId === "job-support" && jobs.support) {
      if (jobs.support.sla_missed_open > 0)
        extra.push(`${jobs.support.sla_missed_open} SLA missed`);
      const long = jobs.support.open_windows.filter((w) => w.active_hours > 24);
      if (long.length > 0)
        extra.push(plural(long.length, "window") + " open > 24 h");
    }
    if (checkId === "job-review" && jobs.review && jobs.review.queued_scans > 0)
      extra.push(`${jobs.review.queued_scans} queued scans`);
    if (
      checkId === "job-quotes" &&
      jobs.quotes &&
      jobs.quotes.send_failures_24h > 0
    )
      extra.push(plural(jobs.quotes.send_failures_24h, "send failure"));
    if (
      checkId === "job-assembly" &&
      jobs.assembly &&
      jobs.assembly.failed_orgs > 0
    )
      extra.push(plural(jobs.assembly.failed_orgs, "site") + " failed");
    if (checkId === "job-billing" && jobs.billing) {
      if (jobs.billing.backlog > 0)
        extra.push(`backlog ${jobs.billing.backlog}`);
      if (jobs.billing.failed_events > 0)
        extra.push(plural(jobs.billing.failed_events, "failed event"));
      if (jobs.billing.restricted_accounts > 0)
        extra.push(
          plural(jobs.billing.restricted_accounts, "restricted account"),
        );
    }
    if (
      checkId === "job-indexing" &&
      doc.indexing &&
      doc.indexing.sitemap_errors > 0
    )
      extra.push(plural(doc.indexing.sitemap_errors, "sitemap error"));
    return [base, ...extra].join(" · ");
  }
  switch (checkId) {
    case "failsafe": {
      const f = doc.failsafe;
      if (!f) return "No reading";
      if (!f.deployed) return "Capture service: not deployed (stand-in)";
      return `${f.active ? "Active" : "Standing by"} · ${plural(f.pending_requests, "pending request")}`;
    }
    case "media-cdn":
    case "media-compress": {
      const m = doc.media;
      if (!m) return "No reading";
      const parts: string[] = [];
      if (checkId === "media-cdn") {
        parts.push(
          m.cdn === "app"
            ? "CDN: app-served (stand-in)"
            : `CDN: ${m.cdn_status}`,
        );
        if (m.fallback_active) parts.push("fallback active");
        if (m.video_paused) parts.push("video paused");
        if (m.origin_errors_1h > 0)
          parts.push(`${m.origin_errors_1h} origin errors in 1 h`);
        if (m.over_allowance > 0)
          parts.push(plural(m.over_allowance, "site") + " over allowance");
      }
      if (m.stuck_videos > 0) parts.push(plural(m.stuck_videos, "stuck video"));
      if (m.compress_failures_24h > 0)
        parts.push(`${m.compress_failures_24h} compression failures in 24 h`);
      return parts.length > 0 ? parts.join(" · ") : "No stuck or failed videos";
    }
    case "email-transport": {
      const e = doc.email;
      if (!e) return "No reading";
      if (!e.sending_enabled) return "Sending disabled";
      return `${plural(e.transport_failures_24h, "failure")} in 24 h`;
    }
    case "forms-scanner": {
      const f = doc.forms;
      if (!f) return "No reading";
      const scanner =
        f.scanner_status === "off"
          ? "File scanner: off (stand-in, uploads fail closed)"
          : `File scanner: ${f.scanner} ${f.scanner_status}`;
      return f.notify_failures_24h > 0
        ? `${scanner} · ${f.notify_failures_24h} notification failures in 24 h`
        : scanner;
    }
    case "beacon": {
      const b = doc.beacon;
      if (!b) return "No reading";
      const parts = [`Last flush ${healthAgo(b.last_flush, now)}`];
      if (b.dropped > 0) parts.push(`${b.dropped} rows dropped`);
      return parts.join(" · ");
    }
    case "review-scanners": {
      const r = doc.review;
      if (!r) return "No reading";
      const parts = [
        `${plural(r.held_pages, "held page")}`,
        `${r.queued_scans} queued scans`,
      ];
      if (r.held_oldest_business_days > 0)
        parts.push(
          `oldest ${plural(r.held_oldest_business_days, "business day")}`,
        );
      for (const [label, p] of [
        ["Text checker", r.text_checker],
        ["Image moderation", r.image_moderator],
        ["Links", r.link_checker],
      ] as const) {
        if (p.status === "error" || p.status === "capped")
          parts.push(`${label} ${p.status}`);
      }
      return parts.join(" · ");
    }
    case "restore-rehearsal": {
      const at = doc.backups?.restore_rehearsed_at ?? null;
      return at ? `Last rehearsed ${healthAgo(at, now)}` : "Never rehearsed";
    }
    case "indexing-submit": {
      const i = doc.indexing;
      if (!i) return "No reading";
      return `${plural(i.indexnow_failures_24h, "IndexNow failure")} in 24 h · ${plural(i.sitemap_submit_errors, "sitemap submission error")}`;
    }
    case "domains-provider":
    case "domains-https":
    case "domains-drift":
    case "domains-expiry":
    case "domains-moves":
    case "domains-sending":
      return domainsReading(checkId, doc);
    default:
      return "No reading";
  }
}

/** Counts-only reading for the P14 `domains` checks (rows 41-50). */
function domainsReading(checkId: string, doc: MonitorStatusDoc): string {
  const d = doc.domains;
  if (!d) return "No reading";
  switch (checkId) {
    case "domains-provider":
      return `Provider: ${d.provider === "fake" ? "fake (stand-in)" : d.provider} · ${plural(d.provider_errors_24h, "error")} in 24 h`;
    case "domains-https": {
      const parts = [plural(d.custom_hosts, "custom domain")];
      if (d.https_failing > 0) parts.push(`${d.https_failing} failing HTTPS`);
      if (d.cert_min_days !== null)
        parts.push(`fewest cert days ${d.cert_min_days}`);
      return parts.join(" · ");
    }
    case "domains-drift":
      return `${d.delegation_lost} delegation lost · ${d.email_drift} email drift · ${d.post_switch_mismatches} post-switch mismatches`;
    case "domains-expiry":
      return `${d.expiring_7d} within 7 days · ${d.expiring_30d} within 30 days`;
    case "domains-moves":
      return `${plural(d.moves_open, "open move")} · ${d.moves_failed} failed · ${d.waiting_ns_over_48h} waiting on nameservers > 48 h · ${plural(d.gate_overrides_pending, "override")} waiting · ${d.offboardings_in_notice} leaving`;
    default:
      return `${d.sending_pending} pending · ${d.sending_failed} failed`;
  }
}

// ------------------------------------------------------------------ incidents
export type HealthIncident = {
  level: "warn" | "critical";
  opened_at: string;
};

function parseIncident(raw: string): HealthIncident | null {
  if (raw === "") return null;
  try {
    const v = JSON.parse(raw) as Partial<HealthIncident>;
    const level = v.level === "critical" ? "critical" : "warn";
    const opened =
      typeof v.opened_at === "string" && v.opened_at !== ""
        ? v.opened_at
        : new Date(0).toISOString();
    return { level, opened_at: opened };
  } catch {
    // An unreadable row still counts as open (monitorStatus counts non-empty rows).
    return { level: "warn", opened_at: new Date(0).toISOString() };
  }
}

/** Every open incident, keyed by check id (one bound query). */
export async function jobReadHealthIncidents(): Promise<
  Map<string, HealthIncident & { rowId: string }>
> {
  const rows = await withSuperuser((pb) =>
    pb.collection("platform_meta").getFullList({
      filter: pb.filter("key ~ {:p}", { p: `${HEALTH_INCIDENT_PREFIX}%` }),
      fields: "id,key,value",
    }),
  );
  const out = new Map<string, HealthIncident & { rowId: string }>();
  for (const r of rows) {
    const key = typeof r.key === "string" ? r.key : "";
    if (!key.startsWith(HEALTH_INCIDENT_PREFIX)) continue;
    const inc = parseIncident(typeof r.value === "string" ? r.value : "");
    if (inc)
      out.set(key.slice(HEALTH_INCIDENT_PREFIX.length), {
        ...inc,
        rowId: r.id,
      });
  }
  return out;
}

async function deleteIncidentRow(rowId: string): Promise<void> {
  await withSuperuser(async (pb) => {
    try {
      await pb.collection("platform_meta").delete(rowId);
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return;
      throw err;
    }
  });
}

// ------------------------------------------------------------------ view
export type StaffHealthRow = {
  id: string;
  label: string;
  /** `none` = nothing to judge or a stand-in (shown in words, never as an error). */
  level: HealthLevel;
  reading: string;
  threshold: string;
  /** ISO time the open incident started, else null. */
  since: string | null;
};

export type StaffHealthJobRow = {
  id: string;
  /** "support:run". */
  job: string;
  label: string;
  schedule: string;
  lastSuccess: string | null;
  level: HealthLevel;
  reading: string;
  warningText: string;
  criticalText: string | null;
  since: string | null;
};

export type StaffHealthPremiumRow = {
  orgId: string;
  business: string;
  addon: string;
  checks: number;
  /** Passing checks; null until premium check runners exist (v1.1). */
  passing: number | null;
  errorRate1h: number | null;
  dbWriteP95Ms: number | null;
  failedEmails1h: number | null;
  level: HealthLevel;
};

export type StaffHealthView = {
  generatedAt: string;
  overall: MonitorStatusDoc["overall"];
  /** The staff alert address, masked ("m•••@example.com"); null = alerts are not sent. */
  alertEmail: string | null;
  components: StaffHealthRow[];
  backups: StaffHealthRow[];
  restore: {
    rehearsedAt: string | null;
    days: number | null;
    level: HealthLevel;
  };
  jobs: StaffHealthJobRow[];
  premium: StaffHealthPremiumRow[];
  failsafe: {
    deployed: boolean;
    active: boolean;
    pendingRequests: number;
    lastPull: string | null;
    level: HealthLevel;
    reading: string;
  } | null;
  /** Every HEALTH_CHECK in brief order. */
  checks: (StaffHealthRow & { brief: number })[];
  openIncidents: number;
};

export type StaffHealthOptions = {
  now?: Date;
  /** `ADDON_REGISTRY.list()` from the caller (Invariant 4, P13-P7). */
  manifests?: readonly MonitorManifest[];
  /** Tests replace a monitorStatus feeder. */
  feeders?: Partial<MonitorFeeders>;
};

const STAND_IN_PROVIDERS = new Set(["keyword", "none", "logging", "stand_in"]);

function providerRow(
  id: string,
  label: string,
  p: { provider: string; status: string },
  extra = "",
): Omit<StaffHealthRow, "since" | "threshold"> {
  const standIn = STAND_IN_PROVIDERS.has(p.provider) || p.status === "skipped";
  let reading: string;
  if (p.status === "skipped") reading = `${label}: skipped (stand-in)`;
  else if (standIn) reading = `${label}: ${p.provider} stand-in`;
  else reading = `${label}: ${p.provider} ${p.status}`;
  const level: HealthLevel =
    p.status === "error" || p.status === "capped"
      ? "warn"
      : standIn
        ? "none"
        : "ok";
  return { id, label, level, reading: reading + extra };
}

function componentRows(
  doc: MonitorStatusDoc,
  levelOf: (checkId: string) => HealthLevel,
): Omit<StaffHealthRow, "since">[] {
  const rows: Omit<StaffHealthRow, "since">[] = [];
  for (const c of doc.components) {
    switch (c.id) {
      case "pocketbase": {
        const ms = c.latency_ms ?? null;
        rows.push({
          id: "pocketbase",
          label: "PocketBase",
          level:
            c.status !== "ok" || ms === null
              ? "critical"
              : ms > 2000
                ? "critical"
                : ms > 500
                  ? "warn"
                  : "ok",
          reading:
            c.status === "ok" && ms !== null
              ? `PocketBase ${ms} ms`
              : "PocketBase not answering",
          threshold: "warn > 500 ms · critical > 2 s",
        });
        break;
      }
      case "email":
        rows.push({
          id: "email",
          label: "Email",
          level: c.status === "stand_in" ? "none" : levelOf("email-transport"),
          reading:
            c.status === "stand_in"
              ? "Email: logged (stand-in)"
              : `Email: ${c.mode ?? "on"}`,
          threshold: healthThresholdText("email-transport"),
        });
        break;
      case "payments":
        rows.push({
          id: "payments",
          label: "Payments",
          level:
            c.status === "stand_in"
              ? "none"
              : c.status === "ok"
                ? "ok"
                : "critical",
          reading:
            c.status === "stand_in"
              ? "Payments: test mode (stand-in)"
              : c.status === "ok"
                ? `Payments: ${c.mode ?? "on"}`
                : "Payments: not configured",
          threshold: "critical when payments are not configured",
        });
        break;
      case "content_scanners": {
        const r = doc.review;
        const threshold = healthThresholdText("review-scanners");
        if (!r) {
          rows.push({
            id: "content_scanners",
            label: "Content scanners",
            level: "none",
            reading: "No reading",
            threshold,
          });
          break;
        }
        rows.push({
          ...providerRow("text_checker", "Text checker", r.text_checker),
          threshold,
        });
        rows.push({
          ...providerRow(
            "image_moderator",
            "Image moderation",
            r.image_moderator,
          ),
          threshold,
        });
        rows.push({
          ...providerRow(
            "link_checker",
            "Links",
            r.link_checker,
            ` · ${r.webrisk_month_lookups.toLocaleString("en-US")} of ${r.webrisk_cap.toLocaleString("en-US")} this month`,
          ),
          threshold,
        });
        break;
      }
      case "file_scanner":
        rows.push({
          id: "file_scanner",
          label: "File scanner",
          level:
            c.status === "off"
              ? "none"
              : c.status === "ok"
                ? levelOf("forms-scanner")
                : "warn",
          reading:
            c.status === "off"
              ? "File scanner: off (stand-in, uploads fail closed)"
              : `File scanner: ${c.mode ?? ""} ${c.status}`.replace("  ", " "),
          threshold: healthThresholdText("forms-scanner"),
        });
        break;
      case "cdn":
        rows.push({
          id: "cdn",
          label: "CDN",
          level:
            c.mode === "app"
              ? "none"
              : c.status === "ok"
                ? levelOf("media-cdn")
                : "critical",
          reading:
            c.mode === "app"
              ? "CDN: app-served (stand-in)"
              : `CDN: ${c.mode ?? "bunny"} ${c.status}`,
          threshold: healthThresholdText("media-cdn"),
        });
        break;
      default:
        break;
    }
  }
  return rows;
}

/** The incident check a component row follows (for its "since"). */
const COMPONENT_CHECK: Readonly<Record<string, string>> = {
  email: "email-transport",
  file_scanner: "forms-scanner",
  cdn: "media-cdn",
  text_checker: "review-scanners",
  image_moderator: "review-scanners",
  link_checker: "review-scanners",
};

/**
 * The console Health view (STAFF-13; 13-45 renders it). Staff only (`health` feature, both
 * roles). Built from one `monitorStatus()` document and the shared thresholds.
 */
export async function staffHealthView(
  ctx: PlatformContext,
  opts: StaffHealthOptions = {},
): Promise<StaffHealthView> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "health");
  const now = opts.now ?? new Date();
  const [doc, incidents] = await Promise.all([
    monitorStatus({
      now,
      manifests: opts.manifests ?? [],
      ...(opts.feeders ? { feeders: opts.feeders } : {}),
    }),
    jobReadHealthIncidents().catch((err: unknown) => {
      console.error(
        `[staff/health] incidents read failed: ${err instanceof Error ? err.name : typeof err}`,
      );
      return new Map<string, HealthIncident & { rowId: string }>();
    }),
  ]);
  const evals = evaluateAll(doc, now);
  const levelOf = (id: string): HealthLevel =>
    evals.find((e) => e.id === id)?.level ?? "none";
  const since = (id: string | undefined): string | null =>
    (id && incidents.get(id)?.opened_at) || null;

  const checks = evals.map((e) => ({
    id: e.id,
    brief: e.brief,
    label: e.label,
    level: e.level,
    reading: healthReading(e.id, doc, now),
    threshold: healthThresholdText(e.id),
    since: since(e.id),
  }));

  const components = componentRows(doc, levelOf).map((r) => ({
    ...r,
    since: since(COMPONENT_CHECK[r.id]),
  }));

  const rehearsedAt = doc.backups?.restore_rehearsed_at ?? null;
  const restoreAge = rehearsedAt
    ? ageMs(rehearsedAt, now)
    : Number.POSITIVE_INFINITY;
  const restore = {
    rehearsedAt,
    days: Number.isFinite(restoreAge) ? Math.floor(restoreAge / DAY) : null,
    level: (doc.backups
      ? restoreAge > RESTORE_WARN_DAYS * DAY
        ? "warn"
        : "ok"
      : "none") as HealthLevel,
  };

  const backupRow = (
    id: string,
    label: string,
    iso: string | null,
    warnMs: number,
  ): StaffHealthRow => ({
    id,
    label,
    level:
      !doc.backups || iso === null
        ? "none"
        : ageMs(iso, now) > warnMs
          ? "warn"
          : "ok",
    reading: iso ? `Last success ${healthAgo(iso, now)}` : "Not reported yet",
    threshold: "warn > 26 h",
    since: null,
  });
  const backups: StaffHealthRow[] = [
    backupRow(
      "db",
      "Database offsite backup",
      doc.backups?.db_last_success ?? null,
      26 * HOUR,
    ),
    backupRow(
      "tenant_exports",
      "Tenant exports",
      doc.backups?.tenant_exports_last_success ?? null,
      26 * HOUR,
    ),
    {
      id: "restore",
      label: "Restore rehearsal",
      level: restore.level,
      reading:
        restore.days === null
          ? "Never rehearsed"
          : `Last rehearsed ${plural(restore.days, "day")} ago`,
      threshold: `warn > ${RESTORE_WARN_DAYS} days`,
      since: since("restore-rehearsal"),
    },
  ];

  const jobs: StaffHealthJobRow[] = HEALTH_JOBS.map((j) => {
    const check = HEALTH_CHECKS.find((c) => c.id === j.checkId);
    const text = HEALTH_THRESHOLD_TEXT[j.checkId];
    const row = doc.jobs[j.job] as { last_success: string | null } | null;
    return {
      id: j.checkId,
      job: j.name,
      label: check?.label ?? j.name,
      schedule: j.schedule,
      lastSuccess: row?.last_success ?? null,
      level: levelOf(j.checkId),
      reading: healthReading(j.checkId, doc, now),
      warningText: text?.warning ?? "",
      criticalText: text?.critical ?? null,
      since: since(j.checkId),
    };
  });

  const names = new Map((doc.tenants ?? []).map((t) => [t.org_id, t.name]));
  const premium: StaffHealthPremiumRow[] = (doc.premium ?? []).map((p) => ({
    orgId: p.org_id,
    business: names.get(p.org_id) ?? p.org_id,
    addon: p.addon,
    checks: p.checks.length,
    passing: null,
    errorRate1h: p.error_rate_1h,
    dbWriteP95Ms: p.db_write_p95_ms,
    failedEmails1h: p.failed_emails_1h,
    level:
      p.status === "unhealthy" ? "critical" : p.status === "ok" ? "ok" : "none",
  }));

  const failsafe = doc.failsafe
    ? {
        deployed: doc.failsafe.deployed,
        active: doc.failsafe.active,
        pendingRequests: doc.failsafe.pending_requests,
        lastPull: doc.failsafe.last_pull,
        level: doc.failsafe.deployed
          ? levelOf("failsafe")
          : ("none" as HealthLevel),
        reading: healthReading("failsafe", doc, now),
      }
    : null;

  const address = staffAlertAddress();
  return {
    generatedAt: doc.generated_at,
    overall: doc.overall,
    alertEmail: address ? maskEmail(address) : null,
    components,
    backups,
    restore,
    jobs,
    premium,
    failsafe,
    checks,
    openIncidents: incidents.size,
  };
}

// ------------------------------------------------------------------ evaluation (health:run)
type HealthAlertData = EmailData["staff.health_alert"];
type SendFn = typeof sendEmail;

export type HealthEvaluateDeps = {
  dryRun?: boolean;
  transport?: EmailTransport;
  /** Tests replace the send path. */
  send?: SendFn;
  manifests?: readonly MonitorManifest[];
  feeders?: Partial<MonitorFeeders>;
  /** Tests pass a ready document instead of reading one. */
  doc?: MonitorStatusDoc;
};

export type HealthEvaluateResult = {
  /** Checks evaluated. */
  checks: number;
  opened: number;
  /** Open warnings that became critical (one more email each). */
  escalated: number;
  closed: number;
  emailsSent: number;
  /** No staff alert address, or the address is suppressed. */
  emailSkipped: number;
  emailFailed: number;
};

type SendOutcome = "sent" | "skipped" | "failed";

async function sendHealthAlert(
  sys: SystemContext,
  data: HealthAlertData,
  deps: HealthEvaluateDeps,
): Promise<SendOutcome> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn("[jobs/health] alert not sent: no staff alert address");
    return "skipped";
  }
  try {
    const r = await (deps.send ?? sendEmail)(
      { kind: "cds", ctx: sys },
      "staff.health_alert",
      to,
      data,
      deps.transport ? { transport: deps.transport } : {},
    );
    if (r.status === "sent") return "sent";
    console.warn("[jobs/health] alert not sent: staff address suppressed");
    return "skipped";
  } catch (err) {
    console.error(
      `[jobs/health] alert failed: ${err instanceof Error ? err.name : typeof err}`,
    );
    return "failed";
  }
}

/**
 * Evaluate every HEALTH_CHECK once and open / escalate / close incidents (P13-P19). Step
 * `checks` of `health:run`. A dry run counts what would change and writes / sends nothing.
 */
export async function jobEvaluateHealth(
  now: Date = new Date(),
  deps: HealthEvaluateDeps = {},
): Promise<HealthEvaluateResult> {
  const sys = mintSystemContext({ job: "health" });
  const dryRun = deps.dryRun === true;
  const doc =
    deps.doc ??
    (await monitorStatus({
      now,
      manifests: deps.manifests ?? [],
      ...(deps.feeders ? { feeders: deps.feeders } : {}),
    }));
  const incidents = await jobReadHealthIncidents();
  const result: HealthEvaluateResult = {
    checks: 0,
    opened: 0,
    escalated: 0,
    closed: 0,
    emailsSent: 0,
    emailSkipped: 0,
    emailFailed: 0,
  };
  const tally = (o: SendOutcome) => {
    if (o === "sent") result.emailsSent += 1;
    else if (o === "skipped") result.emailSkipped += 1;
    else result.emailFailed += 1;
  };

  for (const e of evaluateAll(doc, now)) {
    result.checks += 1;
    const open = incidents.get(e.id) ?? null;
    const key = `${HEALTH_INCIDENT_PREFIX}${e.id}`;
    const threshold = healthThresholdText(e.id);

    if (e.level === "warn" || e.level === "critical") {
      const escalate =
        open !== null && open.level === "warn" && e.level === "critical";
      if (open !== null && !escalate) continue; // already alerted for this incident
      if (escalate) result.escalated += 1;
      else result.opened += 1;
      if (dryRun) continue;
      const openedAt = open?.opened_at ?? now.toISOString();
      const outcome = await sendHealthAlert(
        sys,
        {
          state: "open",
          level: e.level === "critical" ? "critical" : "warning",
          component: e.label,
          reading: healthReading(e.id, doc, now),
          threshold,
          since: new Date(openedAt),
          href: platformUrl(HEALTH_ALERT_HREF),
        },
        deps,
      );
      tally(outcome);
      // A send that threw leaves the state as it was, so the next run retries.
      if (outcome === "failed") continue;
      await writePlatformMeta(
        sys,
        key,
        JSON.stringify({ level: e.level, opened_at: openedAt }),
      );
      continue;
    }

    if (e.level === "ok" && open !== null) {
      result.closed += 1;
      if (dryRun) continue;
      const openedAt = new Date(open.opened_at);
      const outcome = await sendHealthAlert(
        sys,
        {
          state: "close",
          level: open.level === "critical" ? "critical" : "warning",
          component: e.label,
          reading: `Back to normal after ${healthDuration(now.getTime() - openedAt.getTime())}`,
          threshold,
          since: openedAt,
          href: platformUrl(HEALTH_ALERT_HREF),
        },
        deps,
      );
      tally(outcome);
      if (outcome === "failed") continue;
      await deleteIncidentRow(open.rowId);
    }
    // "none": nothing to judge (never run, feeder failed); leave any incident as it is.
  }
  return result;
}
