// Health copy (13-45; STAFF-13, STAFF-14, CONT-19; 13-UI-SPEC "Health" lines 873-908, tones
// line 216, states line 1019). PREMIUM-EMPTY lives in @cds/core/staff P13_COPY. Times are
// shown in the business time zone (Central).
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import type { HealthLevel } from "@cds/core/health";

export const HEALTH_COPY = {
  level: {
    ok: "OK",
    warn: "Warning",
    critical: "Critical",
    none: "No data",
  } satisfies Record<HealthLevel, string>,
  standIn: "Stand-in",
  sinceWord: {
    ok: "OK",
    warn: "Warning",
    critical: "Critical",
    none: "",
  } satisfies Record<HealthLevel, string>,
  none: "—",
  refresh: "Refresh health",
  refreshing: "Refreshing…",
  checked: (ago: string, alert: string | null) =>
    alert
      ? `Checked ${ago} · Alerts email ${alert}`
      : `Checked ${ago} · Alert emails are off (CDS_STAFF_ALERT_EMAIL not set)`,
  cols: {
    component: "Component",
    state: "State",
    reading: "Reading",
    threshold: "Threshold",
    since: "Since",
    job: "Job",
    schedule: "Schedule",
    lastSuccess: "Last success",
    counts: "Last counts",
    site: "Site",
    addon: "Add-on",
    checks: "Health checks",
    errorRate: "Error rate 1h",
    dbWrite: "DB write p95",
    failed: "Failed emails/payments",
    received: "Received",
    request: "Request summary",
    action: "Action",
  },
  platformCaption: "Platform components",
  backupsHeading: "Backups",
  backupsCaption: "Backups and restore rehearsal",
  jobsCaption: "Scheduled jobs",
  jobsNote:
    "Jobs run from the scheduler. This view is read-only; run a job from the terminal if you need it now.",
  premiumCaption: "Premium add-on health per site",
  runbook: "Runbook: docs/ops/restore-rehearsal.md",
  restoreLine: (ago: string | null) =>
    ago ? `Restore last rehearsed ${ago}` : "Restore never rehearsed",
  neverRun: "Not run yet",
  threshold: (warning: string, critical: string | null) =>
    critical
      ? `Warning ${afterWord(warning)} · Critical ${afterWord(critical)}`
      : `Warning ${afterWord(warning)}`,
  failsafe: {
    heading: "Fail-safe requests",
    caption: "Requests captured during an outage",
    filters: "Show",
    empty: "No fail-safe requests. They appear here after an outage.",
    notDeployed: "Capture service: not deployed (GO-LIVE)",
    standIn: "Fail-safe not deployed yet (stand-in)",
    deployed: (pending: number, lastPull: string | null) =>
      `Capture service: deployed · ${pending} waiting${lastPull ? ` · last pull ${lastPull}` : ""}`,
    intent: "Captured during an outage. Not validated (intent only).",
    details: "Captured details",
    name: "Name",
    email: "Email",
    phone: "Phone",
    preferred: "Preferred time",
    message: "Message",
    captured: "Received",
    convert: "Convert",
    convertLabel: (who: string) => `Convert request from ${who}`,
    dismiss: "Dismiss",
    dismissLabel: (who: string) => `Dismiss request from ${who}`,
    dismissTitle: "Dismiss this request?",
    dismissBody:
      "It leaves the list and nothing is created in the add-on. The reason goes in the audit log.",
    dismissConfirm: "Dismiss request",
    dismissSafe: "Keep it",
    reasonLabel: "Reason (spam, already handled by phone …)",
    status: {
      pending: "Pending",
      converted: "Converted",
      dismissed: "Dismissed",
    },
    filter: {
      pending: "Pending",
      converted: "Converted",
      dismissed: "Dismissed",
      all: "All",
    },
    converted: (ref: string) => `Converted. Created ${ref}.`,
    dismissed: "Dismissed.",
    conflictPrefix: "Couldn't convert: ",
  },
  media: {
    caption: "Media storage per site",
    cols: {
      site: "Site",
      images: "Images",
      video: "Video",
      audio: "Audio",
      downloads: "Downloads",
      total: "Total vs allowance",
      delivery: "Delivery this month",
      open: "Open",
    },
    deliveryTitle: "Delivery figures arrive with Bunny stats",
    downloadsTitle: "Downloads aren't counted in media storage",
    over: "Over allowance",
    near: "80 % used",
    openSite: "Open site",
    onlyOver: "Only over allowance",
    empty: "No site stores media yet.",
    emptyOver: "No site is over its allowance.",
    siteEmpty: "This site stores no media yet.",
    summary: (sites: number, stored: string, over: number) =>
      `${sites} ${sites === 1 ? "site" : "sites"} · ${stored} stored · ${over} over allowance`,
    takedown:
      'Take down one file: npm run media:takedown -- --org <id> --asset <id> --reason "…" (how-to: docs/how-to/media-staff-tools.md)',
  },
} as const;

/** "> 2 h, SLA missed" -> "after 2 h, SLA missed"; other wording unchanged. */
function afterWord(text: string): string {
  return text.replace(/^>\s*/, "after ");
}

const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

const FULL = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: BUSINESS_TIME_ZONE,
});

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(t) ? new Date(t) : null;
}

/** "2:10 PM" in Central; null when missing. */
export function formatHealthClock(
  value: string | null | undefined,
): string | null {
  const d = parse(value);
  return d ? TIME.format(d) : null;
}

/** "Oct 2, 2026, 6:00 AM" in Central (cell titles); null when missing. */
export function formatHealthTime(
  value: string | null | undefined,
): string | null {
  const d = parse(value);
  return d ? FULL.format(d) : null;
}

/** "1.2 GB" / "340 MB" / "0 B": storage sizes for the Media usage table. */
export function formatHealthBytes(bytes: number): string {
  const b = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (b >= 1024 ** 3) {
    const n = Math.round((b / 1024 ** 3) * 10) / 10;
    return `${n.toFixed(1).replace(/\.0$/, "")} GB`;
  }
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}
