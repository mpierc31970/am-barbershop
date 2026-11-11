// packages/db/src/offboarding/model.ts (P14, LIFE-01; 14-39). Internal: the offboardings row
// model shared by offboardings.ts and steps.ts (one direction of import, no cycle). Not in the
// barrel; offboardings.ts re-exports the public names.
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";

export const OFFBOARDINGS = "offboardings";

/** The owner-facing steps, in order (14-39 choice 1, D282: DNS first). */
export const OFFBOARDING_STEPS = Object.freeze([
  "dns_handback",
  "download",
  "addons",
  "services",
  "billing",
  "close",
] as const);

/** System steps the staff view shows (14-39 choice 1). `zone_deleted` is driven by 14-40. */
export const OFFBOARDING_SYSTEM_STEPS = Object.freeze([
  "hosts_removed",
  "site_closed",
  "zone_deleted",
] as const);

export type OffboardingOwnerStep = (typeof OFFBOARDING_STEPS)[number];
export type OffboardingSystemStep = (typeof OFFBOARDING_SYSTEM_STEPS)[number];
export type OffboardingStepKey = OffboardingOwnerStep | OffboardingSystemStep;
export type OffboardingStepStatus =
  "open" | "done" | "not_applicable" | "locked";
export type OffboardingStepState = {
  status: OffboardingStepStatus;
  at?: string;
};

export type OffboardingSteps = Record<
  OffboardingStepKey,
  OffboardingStepState
> & {
  /** P14-P36: the notice ended with the DNS handback still open. */
  handback_overdue_at?: string;
  /** Last owner overdue email (the 7-day reminder clock). */
  overdue_mailed_at?: string;
  /** The CDS subscription was ended (notice end; never twice). */
  billing_ended_at?: string;
};

export type OffboardingStatus = "notice" | "closed" | "cancelled";
export type OffboardingReasonCategory =
  "provider" | "closing" | "cost" | "feature" | "other";
export const OFFBOARDING_REASON_CATEGORIES: readonly OffboardingReasonCategory[] =
  Object.freeze(["provider", "closing", "cost", "feature", "other"]);

export type OffboardingRow = {
  id: string;
  orgId: string;
  status: OffboardingStatus;
  requestedBy: string;
  requestedByKind: "owner" | "staff" | null;
  requestedAt: string | null;
  noticeEndsAt: string | null;
  steps: OffboardingSteps;
  reasonCategory: OffboardingReasonCategory | null;
  note: string;
  cancelReason: string;
  cancelledAt: string | null;
  closedAt: string | null;
};

/** The notice period (D282). */
export const NOTICE_DAYS = 30;
/** P14-P36: the overdue owner email repeats this often. */
export const OVERDUE_REMINDER_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const ORG_ID_RE = /^[a-z0-9]{15}$/;

const STATUSES = new Set<OffboardingStepStatus>([
  "open",
  "done",
  "not_applicable",
  "locked",
]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** PocketBase dates ("YYYY-MM-DD HH:MM:SS.sssZ") as ISO, or null. */
export function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  const t = Date.parse(v.replace(" ", "T"));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function stepState(
  v: unknown,
  fallback: OffboardingStepStatus,
): OffboardingStepState {
  if (typeof v !== "object" || v === null) return { status: fallback };
  const o = v as Record<string, unknown>;
  const status = STATUSES.has(o.status as OffboardingStepStatus)
    ? (o.status as OffboardingStepStatus)
    : fallback;
  const at = isoOrNull(o.at);
  return at ? { status, at } : { status };
}

export function parseSteps(v: unknown): OffboardingSteps {
  const src =
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const out = {} as OffboardingSteps;
  for (const k of [...OFFBOARDING_STEPS, ...OFFBOARDING_SYSTEM_STEPS]) {
    out[k] = stepState(src[k], k === "dns_handback" ? "open" : "locked");
  }
  for (const k of [
    "handback_overdue_at",
    "overdue_mailed_at",
    "billing_ended_at",
  ] as const) {
    const at = isoOrNull(src[k]);
    if (at) out[k] = at;
  }
  return out;
}

export function toOffboardingRow(r: RecordModel): OffboardingRow {
  const status = str(r.status);
  const kind = str(r.requested_by_kind);
  const cat = str(r.reason_category);
  return {
    id: r.id,
    orgId: str(r.org_id),
    status: status === "closed" || status === "cancelled" ? status : "notice",
    requestedBy: str(r.requested_by),
    requestedByKind: kind === "owner" || kind === "staff" ? kind : null,
    requestedAt: isoOrNull(r.requested_at),
    noticeEndsAt: isoOrNull(r.notice_ends_at),
    steps: parseSteps(r.steps),
    reasonCategory: (
      OFFBOARDING_REASON_CATEGORIES as readonly string[]
    ).includes(cat)
      ? (cat as OffboardingReasonCategory)
      : null,
    note: str(r.note),
    cancelReason: str(r.cancel_reason),
    cancelledAt: isoOrNull(r.cancelled_at),
    closedAt: isoOrNull(r.closed_at),
  };
}

/** The org's offboardings row (one per org, unique org_id), or null. */
export async function readOffboardingRow(
  orgId: string,
): Promise<OffboardingRow | null> {
  if (!ORG_ID_RE.test(orgId)) return null;
  return withSuperuser(async (pb) => {
    const res = await pb.collection(OFFBOARDINGS).getList(1, 1, {
      filter: pb.filter("org_id = {:org}", { org: orgId }),
      skipTotal: true,
    });
    const r = res.items[0];
    return r ? toOffboardingRow(r) : null;
  });
}

/** Fresh steps at the start of a notice (choice 1). */
export function initialSteps(
  handbackNeeded: boolean,
  at: string,
): OffboardingSteps {
  const after: OffboardingStepStatus = handbackNeeded ? "locked" : "open";
  return {
    dns_handback: handbackNeeded
      ? { status: "open" }
      : { status: "not_applicable", at },
    download: { status: after },
    addons: { status: after },
    services: { status: after },
    billing: { status: after },
    close: { status: after },
    hosts_removed: { status: "open" },
    site_closed: { status: "open" },
    zone_deleted: handbackNeeded
      ? { status: "open" }
      : { status: "not_applicable", at },
  };
}

/** True once the DNS handback is done or not applicable (D282). */
export function handbackSettled(steps: OffboardingSteps): boolean {
  const s = steps.dns_handback.status;
  return s === "done" || s === "not_applicable";
}

/** The notice end as a Date (falls back to now when the row has none). */
export function noticeEnd(row: OffboardingRow, now: Date): Date {
  return row.noticeEndsAt ? new Date(row.noticeEndsAt) : now;
}

/** Whole days left in the notice (never negative). */
export function daysLeft(row: OffboardingRow, now: Date): number {
  const ms = noticeEnd(row, now).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}
