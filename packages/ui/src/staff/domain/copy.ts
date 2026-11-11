// Staff › Site › Domain chrome words and plain-data view types (14-38; 14-UI-SPEC "Staff ›
// Site › Domain", staff badge table). Every string with a UI-SPEC copy id comes from
// P14_COPY / STAFF_STEP_WORDS / GATE_RULE_NAMES in @cds/core/dns; this file holds only the
// labels that have no id (column names, badge words, footers). The view types mirror
// @cds/db `StaffDomainView` (14-37) as plain data: the UI package never imports @cds/db.
import type { BadgeTone } from "../../hub/Badge";
import type { StaffActionResult } from "../dialogs";

export const STAFF_DOMAIN_TIME_ZONE = "America/Chicago";

// ---- View types (plain data, 14-37 contract) ----

export type StaffDomainStepKey =
  | "snapshot"
  | "zone"
  | "gate"
  | "nameservers"
  | "delegation"
  | "site_records"
  | "edge"
  | "https"
  | "cutover"
  | "search";

export type StaffDomainStepStatus =
  | "waiting"
  | "running"
  | "done"
  | "waiting_owner"
  | "failed"
  | "skipped"
  | "cancelled";

export type StaffDomainMoveStatus =
  | "running"
  | "waiting_owner"
  | "prepared"
  | "cutover_running"
  | "done"
  | "failed"
  | "cancelled";

export interface StaffDomainStepData {
  key: StaffDomainStepKey;
  status: StaffDomainStepStatus;
  startedAt?: string;
  finishedAt?: string;
  /** A code ("waiting_dns:3", "https_failed:525"), never a record value. */
  detail?: string;
  attempts?: number;
}

export interface StaffDomainMoveData {
  code: string;
  kind: "launch" | "move";
  fromHost: string;
  toHost: string;
  status: StaffDomainMoveStatus;
  currentStep: StaffDomainStepKey;
  steps: readonly StaffDomainStepData[];
  failedStep: StaffDomainStepKey | null;
  prepared: boolean;
  cancelNote: string | null;
}

export interface StaffDomainHostData {
  host: string;
  kind: string;
  redirectTo: string | null;
  primary: boolean;
  verified: boolean;
  httpsOk: boolean | null;
  certDays: number | null;
}

export type StaffDomainIncident =
  | "delegation_lost"
  | "email_drift"
  | "https_failing"
  | "cert_low"
  | "expiry_30d"
  | "expiry_7d";

export interface StaffDomainSummaryData {
  domain: string | null;
  /** Registrar display name (RDAP). */
  registrar: string | null;
  expiresAt: string | null;
  dnssec: "on" | "off" | "unknown" | null;
  zone: { id: string | null; status: string } | null;
  nameservers: readonly string[];
  delegatedAt: string | null;
  primaryHost: string | null;
  lastHealth: { at: string | null; incidents: readonly StaffDomainIncident[] };
}

export type StaffGateRuleId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7";
export type StaffGateRuleResult =
  "pass" | "fail" | "overridden" | "acknowledged";

export interface StaffGateRuleData {
  rule: StaffGateRuleId;
  name: string;
  result: StaffGateRuleResult;
  hardBlock: boolean;
  overridable: boolean;
  overriddenBy?: string;
  reason?: string;
}

export type StaffGateRecordGroup = "email" | "verification" | "site" | "other";
export type StaffGateRecordResult =
  "match" | "ttl" | "mismatch" | "missing" | "added" | "ack";
export type StaffGateRecordSource = "zone_file" | "scan" | "sweep" | "cds";

export interface StaffGateRecordData {
  group: StaffGateRecordGroup;
  type: string;
  name: string;
  original: string | null;
  copy: string | null;
  sources: readonly StaffGateRecordSource[];
  result: StaffGateRecordResult;
}

export interface StaffPostSwitchRecordData {
  type: string;
  name: string;
  copy: string;
  publicAnswer: readonly string[];
}

// ---- Server action shapes (passed in by 14-51; each resolves a toast message) ----

export type StaffDomainResult = Promise<StaffActionResult<{ message: string }>>;
export type StaffDomainOrgAction = (orgId: string) => StaffDomainResult;
export type StaffDomainTextAction = (
  orgId: string,
  text: string,
) => StaffDomainResult;
export type StaffDomainReasonAction = (
  orgId: string,
  reason: string,
) => StaffDomainResult;
export type StaffDomainOverrideAction = (
  orgId: string,
  rule: StaffGateRuleId,
  reason: string,
) => StaffDomainResult;
export type StaffDomainStartMoveAction = (
  orgId: string,
  input: { domain: string; reason: string },
) => StaffDomainResult;

// ---- Words ----

export const STAFF_DOMAIN_COPY = Object.freeze({
  summary: {
    label: "Domain details",
    domain: "Domain",
    registrar: "Registrar",
    dnssec: "DNSSEC",
    zone: "CDS zone",
    nameservers: "Assigned nameservers",
    delegation: "Delegation seen",
    primary: "Primary host",
    health: "Last health check",
    none: "None",
    notSeen: "Not seen yet",
    noCheck: "No check yet",
    unknownRegistrar: "Unknown registrar",
    expires: (date: string) => `expires ${date}`,
    dnssecWords: { on: "On at parent", off: "Off", unknown: "Unknown" },
    httpsOk: "HTTPS ok",
    httpsFailing: "HTTPS failing",
    certLow: "cert running low",
    emailUnchanged: "email records unchanged",
    emailDrift: "email records changed",
    delegationLost: "delegation lost",
    expiring: "domain expiring",
  },
  hosts: {
    caption: "Hosts for this site",
    host: "Host",
    kind: "Kind",
    primary: "Primary",
    verified: "Verified",
    https: "HTTPS / cert days",
    yes: "Yes",
    no: "No",
    redirect: (to: string) => `redirect → ${to}`,
    httpsOk: "ok",
    httpsFailing: "failing",
    unknown: "—",
    certDays: (n: number) => `${n} days`,
    empty: "No hosts yet.",
  },
  timeline: {
    heading: (kind: string, from: string, to: string) =>
      `Move · ${kind} · ${from} → ${to}`,
    label: "Domain move steps",
    started: "started",
    finished: "finished",
    attempts: (n: number) => `${n} ${n === 1 ? "attempt" : "attempts"}`,
    errorDetail: "Error detail",
    noMove: "No domain move yet.",
    actionsLabel: "Move actions",
    zoneDrawer: "Add zone file",
    zoneHint: "Drop the zone file here, or",
    zoneReading: "Reading the zone file…",
    cancelTitle: (domain: string) => `Cancel the move to ${domain}?`,
    cancelBefore: (from: string) =>
      `The CDS zone is deleted. The site stays on ${from}. The owner sees "Connect your domain" again.`,
    cancelAfter: (from: string) => `The site stays on ${from}.`,
    reason: "Reason",
    reasonHelper: "10 to 500 characters. Kept in the audit log.",
    site: "Site",
    domain: "Domain",
    move: "Move",
  },
  moveStatus: {
    running: "Running",
    waiting_owner: "Waiting on owner",
    prepared: "Prepared",
    cutover_running: "Cutover running",
    done: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  } satisfies Record<StaffDomainMoveStatus, string>,
  stepStatus: {
    waiting: "Waiting",
    running: "Running",
    done: "Done",
    waiting_owner: "Waiting on owner",
    failed: "Failed",
    skipped: "Skipped",
    cancelled: "Cancelled",
  } satisfies Record<StaffDomainStepStatus, string>,
  postSwitch: {
    title: (count: number, when: string | null) =>
      `Post-switch check failed · ${count} email-critical ${
        count === 1 ? "record differs" : "records differ"
      } at 1.1.1.1 and 8.8.8.8${when ? ` · owner told to switch back ${when}` : ""}`,
    caption: "Records that differ after the switch",
    type: "Type",
    name: "Name",
    copy: "Copy",
    publicAnswer: "Public answer",
    noAnswer: "No answer",
  },
  gate: {
    heading: "Gate report",
    rulesCaption: "Gate rules",
    rule: "Rule",
    result: "Result",
    hardBlock: "Hard block",
    action: "Action",
    pass: "Pass",
    fail: "Fail",
    overriddenBy: (by: string) => `Overridden by ${by}`,
    overridden: "Overridden",
    acknowledged: "Acknowledged by owner",
    overrideTitle: (rule: string, domain: string) =>
      `Override ${rule} for ${domain}?`,
    overrideBody:
      "The owner's nameserver step unlocks. Their email depends on this record set being complete.",
    keepBlock: "Keep the block",
    recordsCaption: "Records: original and copy",
    filter: "Show records",
    problems: "Problems",
    all: "All",
    type: "Type",
    name: "Name",
    original: "Original",
    copy: "Copy (read from assigned NS)",
    reverseOriginal: "CDS zone",
    reverseCopy: "Destination answers",
    source: "Source",
    none: "—",
    noProblems: "No problems. Every record matches.",
    noRecords: "No records in the snapshot.",
    groups: {
      email: "Email",
      verification: "Verification",
      site: "Site",
      other: "Other",
    } satisfies Record<StaffGateRecordGroup, string>,
    sources: {
      zone_file: "zone file",
      scan: "scan",
      sweep: "sweep",
      cds: "CDS",
    } satisfies Record<StaffGateRecordSource, string>,
    results: {
      match: "Match",
      ttl: "Match · TTL differs",
      mismatch: "Mismatch",
      missing: "Missing",
      added: "Added by CDS",
      ack: "Acknowledged",
    } satisfies Record<StaffGateRecordResult, string>,
    footer: (
      at: string,
      count: number,
      from: string | null,
      reverse: boolean,
    ) =>
      `Snapshot ${at} · ${count} ${count === 1 ? "record" : "records"} · ${
        from
          ? `read back from ${from}`
          : reverse
            ? "destination not read yet"
            : "not read back"
      }`,
    noSnapshot: "No snapshot yet.",
  },
  moveDialog: {
    newDomain: "New domain",
    consequence: (current: string) =>
      `The site stays on ${current} until the move finishes. The old domain then sends visitors to the new one, for as long as it stays on CDS DNS.`,
    next: "Next",
    title: (business: string, domain: string) =>
      `Move ${business} to ${domain}?`,
    lines: (current: string, domain: string) =>
      `CDS copies ${domain}'s DNS and asks the owner to change its nameservers. ${current} keeps serving until the switch, then redirects to ${domain}.`,
    notNow: "Not now",
    invalid: "Enter a domain like example.com.",
    subdomain: "Enter the main domain, not a subdomain.",
    reserved: "That address belongs to CDS.",
    same: "That's the domain the site is on now.",
  },
});

/** The `m-*` tone for a step status (UI-SPEC staff badge table). */
export const STEP_STATUS_TONE: Readonly<
  Record<StaffDomainStepStatus, BadgeTone>
> = Object.freeze({
  waiting: "m-waiting",
  running: "m-running",
  done: "m-done",
  waiting_owner: "m-owner",
  failed: "m-failed",
  skipped: "m-skipped",
  cancelled: "m-cancelled",
});

/** The `m-*` tone for a whole move's status badge. */
export const MOVE_STATUS_TONE: Readonly<
  Record<StaffDomainMoveStatus, BadgeTone>
> = Object.freeze({
  running: "m-running",
  waiting_owner: "m-owner",
  prepared: "m-prepared",
  cutover_running: "m-running",
  done: "m-done",
  failed: "m-failed",
  cancelled: "m-cancelled",
});

/** The `g-*` tone for a record result. */
export const RECORD_RESULT_TONE: Readonly<
  Record<StaffGateRecordResult, BadgeTone>
> = Object.freeze({
  match: "g-match",
  ttl: "g-ttl",
  mismatch: "g-mismatch",
  missing: "g-missing",
  added: "g-added",
  ack: "g-ack",
});

/** Staff words for a step detail code (carry 14-23); unknown codes show as they are. */
export function staffStepDetailWords(
  detail: string | undefined,
): string | null {
  if (!detail) return null;
  const [code, arg] = detail.split(":", 2) as [string, string | undefined];
  switch (code) {
    case "waiting_dns":
      return `Waiting for 1.1.1.1 and 8.8.8.8 to answer the edge address${arg ? ` (try ${arg})` : ""}`;
    case "waiting_https":
      return `Waiting for HTTPS${arg ? ` (try ${arg})` : ""}`;
    case "waiting_ns":
      return "Waiting on the owner's nameserver change";
    case "cds_review":
      return "Gate needs CDS review";
    case "edge_ip_unset":
      return "CDS_EDGE_IPV4 is not set";
    case "no_zone":
      return "No CDS zone for this domain";
    case "dns_not_pointing":
      return "Apex or www does not answer the edge address";
    case "host_taken":
      return "The host belongs to another site";
    case "https_failed":
      return `HTTPS check failed${arg ? ` (${arg})` : ""}`;
    case "site_blocked":
      return "The site is blocked (suspended or closed)";
    case "no_host":
      return "No host row for this domain";
    case "provider_error":
      return `DNS provider error${arg ? ` (${arg})` : ""}`;
    default:
      return detail;
  }
}

/** "10 Oct 09:14" in Central time (the console's compact date-time). */
export function formatDomainWhen(
  iso: string | null | undefined,
  timeZone: string = STAFF_DOMAIN_TIME_ZONE,
): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("hour")}:${get("minute")}`;
}

/** "3 Mar 2027" in Central time. */
export function formatDomainDate(
  iso: string | null | undefined,
  timeZone: string = STAFF_DOMAIN_TIME_ZONE,
): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Native table chrome shared by the domain tables (StaffTable look, no row links). */
export const DOMAIN_TABLE = Object.freeze({
  table: "w-full border-collapse font-hub text-sm",
  headRow: "h-10 border-b border-hub-border bg-hub-surface-2",
  th: "px-4 py-2 text-left align-middle font-semibold text-hub-ink",
  row: "border-b border-hub-border pointer-coarse:h-11",
  td: "px-4 py-2 text-left align-top text-hub-ink",
  value: "font-mono text-sm break-all",
});
