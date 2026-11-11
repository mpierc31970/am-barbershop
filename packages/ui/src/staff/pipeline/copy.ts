// Pipeline copy (13-34; STAFF-01, STAFF-03, STAFF-04; 13-UI-SPEC "Pipeline" lines 610-677,
// "Copywriting Contract" line 1033). The words the Pipeline tabs and the action island use, in
// one place. Copy IDs (SUPER_ONLY, LAUNCH_ANYWAY) and dialog titles stay in P13_COPY /
// P13_DIALOGS (@cds/core/staff). Pure and browser-safe; no @cds/db import, so the view types
// mirror the @cds/db read models (the panels map rows into them).
import type { BadgeTone } from "../../hub/Badge";

export const PIPELINE_COPY = {
  none: "—",
  leads: {
    caption: "Leads, newest activity first",
    since: "Time range",
    sinceOptions: { "7d": "7 days", "30d": "30 days", all: "All" },
    stages: "Stage",
    onlyAbandoned: "Only abandoned",
    filters: "Lead filters",
    unnamed: "Unnamed quote",
    abandoned: (days: number) => `Abandoned · ${days}d`,
    cols: {
      business: "Business",
      stage: "Stage",
      path: "Path",
      activity: "Last activity",
      email: "Owner email",
      status: "Status",
      open: "Lead",
    },
    reveal: "Reveal email",
    revealing: "Revealing…",
    open: "Open lead",
    noOrg: "Quote only",
    empty: "No leads in this range.",
    summary: (n: number, abandoned: number) =>
      `${n} ${n === 1 ? "lead" : "leads"} · ${abandoned} abandoned`,
  },
  fit: {
    empty: "No fit holds.",
    caption: "Fit holds, oldest first",
    business: "Business",
    type: "Business type",
    description: "Description",
    verdict: "Screening verdict",
    reasons: "Why it was held",
    heldSince: "Held since",
    verdicts: { clear: "Clear", review: "Needs review", blocked: "Blocked" },
    blockedLabel: "Blocked by screening. Override needs a reason.",
    override: "Override the block",
    openIntake: "Open the site",
    approve: "Approve fit",
    decline: "Decline fit",
    reason: "Reason",
    reasonCategory: "Reason",
    note: "Note to the owner",
    noteHelper: "Optional. One sentence.",
    categories: {
      fit: "Fit",
      capacity: "Capacity",
      scope: "Scope",
      other: "Other",
    },
    unpaidConsequence: "The owner is emailed. Nothing has been paid.",
    declineUnpaid: "Decline",
    declinePaid: "Decline and refund",
    pickReason: "Pick a reason.",
    otherNeedsNote: "Other needs a one-sentence note to the owner.",
    /** CR-D02: the payment state read failed, so Decline is off (never "unpaid" by default). */
    refundUnknown: "Couldn't read payment state. Reload before declining.",
  },
  building: {
    empty: "No sites being built.",
    caption: "Sites being built, longest in stage first",
    cols: {
      business: "Business",
      stage: "Stage",
      assembly: "Assembly",
      note: "Build note",
      paid: "Paid",
      age: "Age in stage",
      actions: "Actions",
    },
    stages: { ready_for_build: "Ready for build", being_built: "Being built" },
    notAssembled: "Not assembled",
    queued: "Assembly queued",
    running: "Assembling…",
    failed: (code: string | null) => (code ? `Failed · ${code}` : "Failed"),
    assembled: (ago: string, unfilled: number) =>
      `Assembled ${ago} ago · ${unfilled} unfilled ${unfilled === 1 ? "slot" : "slots"}`,
    editNote: "Edit note",
    saveNote: "Save note",
    saving: "Saving…",
    cancel: "Cancel",
    noteLabel: "Build note",
    noteHelper: "The owner sees this on Today as “What CDS is doing now”.",
    noteSaved: "Build note saved.",
    noteCleared: "Build note cleared.",
    rerun: "Re-run assembly",
    rerunTitle: (business: string) => `Re-run assembly for ${business}?`,
    rerunBody:
      "Edited pages are left alone; deleted pages are never recreated.",
    rerunSafe: "Not now",
    rerunReport: (business: string) => `Assembly report · ${business}`,
    moveToPolish: "Move to polish",
    beingBuilt: "Being built",
    notPaid: "Not paid",
  },
  polish: {
    empty: "No sites waiting for polish.",
    assembled: "Assembled",
    unfilled: "Unfilled slots",
    toPolish: "To polish",
    notes: "Build note",
    viewPreview: "View preview",
    noPreview: "No preview host yet",
    slotsFor: (business: string) => `Slot report · ${business}`,
    markReady: "Mark ready for owner review",
    sendTitle: (business: string) => `Send ${business} to review?`,
    sendBody: "Today switches to the launch review and the owner is alerted.",
    sendConfirm: "Send to review",
    sendSafe: "Not yet",
  },
  slots: {
    caption: "Slot report, unfilled first",
    cols: {
      slot: "Slot",
      page: "Page",
      from: "Filled from",
      status: "Status",
    },
    from: { provided: "Intake", fallback: "Default", omitted: "Empty" },
    filled: "Filled",
    unfilled: "Unfilled",
    counts: (filled: number, unfilled: number) =>
      `${filled} filled · ${unfilled} unfilled`,
    empty: "No slot report yet.",
  },
  launch: {
    empty: "No sites waiting for launch.",
    caption: "Sites waiting for launch",
    checklist: "Launch checklist",
    progress: (done: number, total: number) => `${done} of ${total}`,
    changeRequests: "Open change requests",
    noChanges: "None",
    inReview: "In review since",
    approve: "Approve launch",
    liveLine: "The owner sees “You're live” on their next visit.",
    warning: (notDone: number, open: number) =>
      [
        notDone > 0
          ? `${notDone} checklist ${notDone === 1 ? "item" : "items"} not done`
          : "",
        open > 0
          ? `${open} open change ${open === 1 ? "request" : "requests"}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    ticket: (n: number) => `#${n}`,
    viewPreview: "View preview",
  },
} as const;

export type PipelineLeadsSince = "7d" | "30d" | "all";

/** Mirrors @cds/db FitVerdict. */
export type FitVerdictView = "clear" | "review" | "blocked";

export const FIT_VERDICT_TONE: Readonly<Record<FitVerdictView, BadgeTone>> = {
  clear: "on-site",
  review: "s-fit",
  blocked: "failed",
};

/** Mirrors @cds/db StaffSlotRow["source"]. */
export type SlotSourceView = "provided" | "fallback" | "omitted";

/** "keyword: bakery" reasons → the matched terms ("bakery"), lower-cased and unique. */
export function fitTerms(reasons: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of reasons) {
    const m = /^keyword:\s*(.+)$/i.exec(r.trim());
    if (m?.[1]) out.add(m[1].trim().toLowerCase());
  }
  return [...out].filter((t) => t.length > 0);
}

/** Split text into plain and matched parts (case-insensitive) for `<mark>` highlighting. */
export function highlightParts(
  text: string,
  terms: readonly string[],
): { text: string; match: boolean }[] {
  if (terms.length === 0 || text === "") return [{ text, match: false }];
  const escaped = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: text.slice(last, i), match: false });
    parts.push({ text: m[0], match: true });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}
