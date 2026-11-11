// Lead read helpers (STAFF-01, D28; P13-P22). Pure and browser-safe: the abandoned rule, the
// Pipeline stage chip for a lead, and the masked owner email the console shows by default.
// Stub from 13-02; body by 13-14. Clock is always injected (`now`), never read here.

/** 7 × 24 h without activity (CONTEXT Pipeline: "no activity for 7 days and no checkout"). */
export const LEAD_ABANDONED_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;

/** The eight Pipeline stage chips, in order (UI-SPEC Pipeline › Leads `StageChips`). */
export const LEAD_STAGE_CHIPS = [
  { id: "saved_quote", label: "Saved quote" },
  { id: "intake_started", label: "Intake started" },
  { id: "submitted", label: "Submitted" },
  { id: "fit_review", label: "Fit review" },
  { id: "paid", label: "Paid" },
  { id: "building", label: "Building" },
  { id: "review", label: "Review" },
  { id: "live", label: "Live" },
] as const;

export type LeadStageChip = (typeof LEAD_STAGE_CHIPS)[number]["id"];

/** The lead facts the rules need (a structural subset of @cds/db `Lead`). */
export type LeadFacts = {
  kind: "quote" | "org";
  /**
   * The `listLeads` status word: "saved" | "reminded n" | "expired" | "intake k/7" |
   * "fit_review" | "sent" | "being built" (plus "ready_for_review" | "live" for completeness).
   */
  status: string;
  /** The org has paid (billing_accounts.paid_at set). */
  paid?: boolean;
};

export type AbandonedInput = {
  kind: "quote" | "intake" | "org" | "other";
  lastActivityAt: Date | string | null;
  checkoutStartedAt?: Date | string | null;
};

function toTime(v: Date | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(" ", "T"));
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Abandoned = a saved quote or an unfinished intake, no activity for 7 days, and no checkout
 * started (a checkout resets it). `days` is whole days since the last activity (0 when unknown
 * or in the future), returned whether or not the lead is abandoned.
 */
export function isAbandonedLead(
  lead: AbandonedInput,
  now: Date,
): { abandoned: boolean; days: number } {
  const last = toTime(lead.lastActivityAt);
  const idle = last === null ? 0 : Math.max(0, now.getTime() - last);
  const days = Math.floor(idle / DAY_MS);
  const eligible = lead.kind === "quote" || lead.kind === "intake";
  const checkout = toTime(lead.checkoutStartedAt ?? null) !== null;
  return {
    abandoned:
      eligible && last !== null && !checkout && idle >= LEAD_ABANDONED_MS,
    days,
  };
}

/** The abandoned-rule kind for a lead: quotes are quotes, orgs still at intake are intakes. */
export function abandonedKindOf(lead: LeadFacts): AbandonedInput["kind"] {
  if (lead.kind === "quote") return "quote";
  return lead.status.startsWith("intake") ? "intake" : "org";
}

/**
 * The stage chip for a lead. Flow: quote saved → intake started → intake sent ("submitted",
 * ready_for_build unpaid) or held ("fit review") → paid → building → review → live.
 */
export function leadStageChip(lead: LeadFacts): LeadStageChip {
  const s = lead.status;
  if (lead.kind === "quote") return "saved_quote";
  if (s === "live") return "live";
  if (s === "ready_for_review" || s === "review") return "review";
  if (s === "being built" || s === "being_built") return "building";
  if (s === "fit_review") return "fit_review";
  if (s === "sent" || s === "ready_for_build") {
    return lead.paid ? "paid" : "submitted";
  }
  return "intake_started";
}

const EMAIL_RE = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/;

/** "maria@rivera.com" → "m•••@rivera.com"; anything malformed → "•••". */
export function maskEmail(email: unknown): string {
  if (typeof email !== "string") return "•••";
  const m = EMAIL_RE.exec(email.trim());
  if (!m) return "•••";
  return `${m[1].charAt(0)}•••@${m[2]}`;
}
