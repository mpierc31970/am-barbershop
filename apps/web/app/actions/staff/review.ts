"use server";
// Review queue actions (13-38 choice 1; STAFF-23, STAFF-24, STAFF-26; D248, D249, D292;
// T-13-38-01..03). Public POST endpoints: every argument is untrusted. Thin callers of the
// 13-23 review functions; each outcome is gated by its own feature before @cds/db re-checks:
//   cleared / rejected / upheld / restored   review_queue            no step-up
//   fix_requested (Ask to fix: the 3-day notice) suspend_notice      no step-up
//   suspended (Suspend…)                     suspend_now (super)     step-up
//   removed, media file                      media_takedown (super)  step-up (as media:takedown)
//   removed, page                            review_queue            no step-up (UI-SPEC: both)
// A logged report is a case, never a ticket (D292): no support function is called here.
// Errors are logged by class name only; bodies, URLs and reporter contact are never logged.
import { fromBusinessLocalInput } from "@cds/core/support";
import {
  listReviewQueue,
  staffAddCaseStep,
  staffAssignCase,
  staffCaseOutcome,
  staffCreateCase,
  staffGetCase,
  staffMarkSpotPage,
  staffResolveFlag,
  type PlatformContext,
  type ReviewOutcomeOptions,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { contentDeps } from "../../../lib/content";
import { nextInvalidator } from "../../../lib/invalidator";
import {
  validateReport,
  type ReportField,
  type ReportValues,
} from "../../../lib/report-form";
import { SECTION_REGISTRY } from "../../../lib/section-registry";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const REF_RE = /^R-[1-9]\d{0,8}$/i;
const ID_RE = /^[a-z0-9]{15}$/;
const NOTE_MAX = 1000;
const MESSAGE_MAX = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CASE_OUTCOMES = [
  "cleared",
  "fix_requested",
  "removed",
  "suspended",
  "upheld",
  "restored",
  "rejected",
] as const;
type CaseOutcome = (typeof CASE_OUTCOMES)[number];
type FlagOutcome = "cleared" | "fix_requested" | "removed" | "suspended";
const FLAG_OUTCOMES: readonly string[] = [
  "cleared",
  "fix_requested",
  "removed",
  "suspended",
];
const SUSPEND_CATEGORIES = ["illegal", "legal_demand", "dmca"] as const;

/** Timeline steps the console records directly (upheld / restored are outcomes). */
const CASE_STEPS = [
  "content_disabled",
  "tenant_notified",
  "counter_notice",
  "restore_date_set",
  "closed",
] as const;
type CaseStepInput = (typeof CASE_STEPS)[number];

const NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That case wasn't found. Reload the review queue.",
};

function bad(message: string, field?: string): Failure {
  return {
    ok: false,
    code: "invalid_input",
    message,
    ...(field ? { field } : {}),
  };
}

function own(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function text(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function refOf(raw: unknown): string | null {
  const v = text(raw);
  if (REF_RE.test(v)) return `R-${v.slice(2)}`;
  return null;
}

function refresh(): void {
  try {
    revalidatePath("/staff", "layout");
  } catch (err) {
    console.error("[staff review] revalidate failed", errorName(err));
  }
}

/** The outcome options a dialog may send (note, owner message, suspend category). */
function outcomeOpts(
  raw: unknown,
  outcome: CaseOutcome,
): { opts: ReviewOutcomeOptions } | Failure {
  const note = text(own(raw, "note"));
  const message = text(own(raw, "message"));
  const category = text(own(raw, "suspendCategory"));
  if (note.length > NOTE_MAX)
    return bad(`Use ${NOTE_MAX} characters or fewer.`, "note");
  if (message.length > MESSAGE_MAX)
    return bad(`Use ${MESSAGE_MAX} characters or fewer.`, "message");
  if (outcome === "fix_requested" && !message) {
    return bad("Add what the owner should fix.", "message");
  }
  if (outcome === "suspended" && !note) {
    return bad("Add a staff note: why the site goes offline.", "note");
  }
  if (
    category &&
    !(SUSPEND_CATEGORIES as readonly string[]).includes(category)
  ) {
    return bad("Pick a reason.", "suspendCategory");
  }
  const opts: ReviewOutcomeOptions = {
    ...(note ? { note } : {}),
    ...(message ? { message } : {}),
    ...(category
      ? {
          suspendCategory: category as ReviewOutcomeOptions["suspendCategory"],
        }
      : {}),
    invalidator: nextInvalidator,
    content: contentDeps(),
    media: { sections: SECTION_REGISTRY, invalidator: nextInvalidator },
  };
  return { opts };
}

/** Feature + step-up for an outcome (T-13-38-01). `media` = the target is a media file. */
function gateFor(
  outcome: CaseOutcome,
  media: boolean,
): { feature: string; stepUp: boolean } {
  if (outcome === "suspended") return { feature: "suspend_now", stepUp: true };
  if (outcome === "removed" && media)
    return { feature: "media_takedown", stepUp: true };
  if (outcome === "fix_requested")
    return { feature: "suspend_notice", stepUp: false };
  return { feature: "review_queue", stepUp: false };
}

function outcomeMessage(
  outcome: CaseOutcome,
  what: { ref: string; title: string; business: string | null; media: boolean },
): string {
  const site = what.business || "The site";
  switch (outcome) {
    case "cleared":
      return what.title
        ? `Cleared. ${what.title} is published.`
        : `Cleared ${what.ref}.`;
    case "fix_requested":
      return `Notice sent to ${site}. 3 days to fix.`;
    case "removed":
      return what.media
        ? `Taken down${what.title ? `: ${what.title}` : ""}.`
        : `Unpublished${what.title ? `: ${what.title}` : ""}.`;
    case "suspended":
      return `${site} is suspended. The public site is offline.`;
    case "upheld":
      return `${what.ref} upheld.`;
    case "restored":
      return `${what.ref} restored.`;
    case "rejected":
      return `${what.ref} rejected and closed.`;
  }
}

/** "Page · About us" -> "About us"; "Image · hero.jpg" -> "hero.jpg". */
function bareTitle(title: string): string {
  const i = title.indexOf(" · ");
  return i >= 0 ? title.slice(i + 3) : "";
}

export type ReviewOutcomeData = {
  message: string;
  ref: string;
  outcome: string;
  flagsResolved: number;
};

/**
 * Apply an outcome to a case `R-<n>` (Clear hold, Ask to fix, Remove content, Suspend…, plus
 * the DMCA Mark upheld / Mark restored and Reject). `opts`: `{ note?, message?, suspendCategory? }`.
 */
export async function caseOutcomeAction(
  ref: unknown,
  outcome: unknown,
  opts?: unknown,
): Promise<ActionResult<ReviewOutcomeData>> {
  const code = refOf(ref);
  if (!code) return NOT_FOUND;
  if (
    typeof outcome !== "string" ||
    !(CASE_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    return bad("Pick an outcome.");
  }
  const o = outcome as CaseOutcome;
  const parsed = outcomeOpts(opts, o);
  if ("ok" in parsed) return parsed;

  // Read the case first (review_queue) so the gate knows whether removal is a media takedown.
  const read = await runStaffAction("review_queue", {}, (ctx) =>
    staffGetCase(ctx, code),
  );
  if (!read.ok) return read;
  const c = read.data;
  const media = c.targetCollection === "media_assets";
  const gate = gateFor(o, media);
  const result = await runStaffAction(
    gate.feature,
    { stepUp: gate.stepUp },
    async (ctx) => {
      const r = await staffCaseOutcome(ctx, code, o, parsed.opts);
      return {
        message: outcomeMessage(o, {
          ref: r.ref,
          title: "",
          business: c.business,
          media,
        }),
        ref: r.ref,
        outcome: r.outcome,
        flagsResolved: r.flagsResolved,
      };
    },
  );
  if (result.ok) refresh();
  return result;
}

async function flagItem(ctx: PlatformContext, flagId: string) {
  const open = await listReviewQueue(ctx, { tab: "flags" });
  const hit = open.find((i) => i.ref === flagId && !i.readOnly);
  if (hit) return hit;
  return null;
}

/** Apply an outcome to a scan flag or hold straight from the queue (no case row). */
export async function flagOutcomeAction(
  flagId: unknown,
  outcome: unknown,
  opts?: unknown,
): Promise<ActionResult<ReviewOutcomeData>> {
  const id = text(flagId).replace(/^flag-/, "");
  if (!ID_RE.test(id)) return NOT_FOUND;
  if (typeof outcome !== "string" || !FLAG_OUTCOMES.includes(outcome)) {
    return bad("Pick an outcome.");
  }
  const o = outcome as FlagOutcome;
  const parsed = outcomeOpts(opts, o);
  if ("ok" in parsed) return parsed;

  const read = await runStaffAction("review_queue", {}, (ctx) =>
    flagItem(ctx, id),
  );
  if (!read.ok) return read;
  const item = read.data;
  if (!item) return bad("This flag is already handled.");
  const media = item.target.collection === "media_assets";
  const gate = gateFor(o, media);
  const result = await runStaffAction(
    gate.feature,
    { stepUp: gate.stepUp },
    async (ctx) => {
      const r = await staffResolveFlag(ctx, id, o, parsed.opts);
      return {
        message: outcomeMessage(o, {
          ref: r.ref,
          title: bareTitle(item.target.title),
          business: item.business,
          media,
        }),
        ref: r.ref,
        outcome: r.outcome,
        flagsResolved: r.flagsResolved,
      };
    },
  );
  if (result.ok) refresh();
  return result;
}

const STEP_MESSAGES: Readonly<Record<CaseStepInput, string>> = {
  content_disabled: "Content disabled recorded.",
  tenant_notified: "Owner notified recorded.",
  counter_notice: "Counter-notice recorded.",
  restore_date_set: "Restore date set.",
  closed: "Case closed.",
};

/**
 * Record the next timeline step. `restoreDate` is a `YYYY-MM-DD` calendar day (America/Chicago);
 * @cds/db checks it is 10-14 business days after the counter-notice.
 */
export async function addCaseStepAction(
  ref: unknown,
  step: unknown,
  note?: unknown,
  restoreDate?: unknown,
): Promise<ActionResult<{ message: string; ref: string; step: string }>> {
  const code = refOf(ref);
  if (!code) return NOT_FOUND;
  if (
    typeof step !== "string" ||
    !(CASE_STEPS as readonly string[]).includes(step)
  ) {
    return bad("Pick a step.");
  }
  const s = step as CaseStepInput;
  const n = text(note);
  if (n.length > NOTE_MAX)
    return bad(`Use ${NOTE_MAX} characters or fewer.`, "note");
  let restore: string | null = null;
  if (s === "restore_date_set") {
    const d = text(restoreDate);
    if (!DATE_RE.test(d)) return bad("Pick the restore date.", "restoreDate");
    // Noon UTC lands on the same Chicago calendar day in both CST and CDT.
    restore = `${d}T17:00:00.000Z`;
    if (Number.isNaN(Date.parse(restore)))
      return bad("Pick the restore date.", "restoreDate");
  }
  const result = await runStaffAction("review_queue", {}, async (ctx) => {
    const c = await staffAddCaseStep(ctx, code, {
      step: s,
      ...(n ? { note: n } : {}),
      ...(restore ? { restoreDate: restore } : {}),
    });
    return { message: STEP_MESSAGES[s], ref: c.ref, step: s };
  });
  if (result.ok) refresh();
  return result;
}

/** Assign a case: a staff user id, "me", or null / "none" to unassign. */
export async function assignCaseAction(
  ref: unknown,
  assignee: unknown,
): Promise<ActionResult<{ message: string; assignee: string | null }>> {
  const code = refOf(ref);
  if (!code) return NOT_FOUND;
  const raw = assignee === null ? "none" : text(assignee);
  if (raw !== "me" && raw !== "none" && !ID_RE.test(raw)) {
    return bad("Pick a CDS staff member.", "assignee");
  }
  const result = await runStaffAction("review_queue", {}, async (ctx) => {
    const to = raw === "me" ? ctx.actor : raw === "none" ? null : raw;
    const r = await staffAssignCase(ctx, code, to);
    return {
      message: r.assignee
        ? `${r.ref} assigned${raw === "me" ? " to you" : ""}.`
        : `${r.ref} unassigned.`,
      assignee: r.assignee,
    };
  });
  if (result.ok) refresh();
  return result;
}

/** Mark one spot-check page OK or Issue (an Issue keeps a staff note; Ask to fix follows). */
export async function markSpotPageAction(
  ref: unknown,
  pageId: unknown,
  state: unknown,
  note?: unknown,
): Promise<ActionResult<{ message: string; state: "ok" | "issue" }>> {
  const code = refOf(ref);
  if (!code) return NOT_FOUND;
  const page = text(pageId);
  if (!ID_RE.test(page)) return NOT_FOUND;
  if (state !== "ok" && state !== "issue") return bad("Mark it OK or Issue.");
  const mark: "ok" | "issue" = state;
  const n = text(note);
  if (n.length > NOTE_MAX)
    return bad(`Use ${NOTE_MAX} characters or fewer.`, "note");
  const result = await runStaffAction("review_queue", {}, async (ctx) => {
    await staffMarkSpotPage(ctx, code, {
      pageId: page,
      state: mark,
      ...(mark === "issue" && n ? { note: n } : {}),
    });
    return {
      message:
        mark === "ok"
          ? "Marked OK."
          : "Marked as an issue. Ask to fix or remove it next.",
      state: mark,
    };
  });
  if (result.ok) refresh();
  return result;
}

const RECEIVED_VIA = ["email", "phone", "other"] as const;
type ReceivedVia = (typeof RECEIVED_VIA)[number];
/** Stand-in address for validating a report entered without one (phone calls). */
const NO_EMAIL = "no-email@staff-entry.invalid";

export type LogReportData = {
  ref: string;
  orgId: string | null;
  message: string;
};

/**
 * "Log a report" (abuse@ mail or a phone call entered by hand): the /report fields plus
 * Received by / Received at (datetime-local, America/Chicago). Email is optional here (a caller
 * may not give one) except for copyright notices. Creates R-n; the owner is not contacted.
 */
export async function logReportAction(
  input: unknown,
): Promise<ActionResult<LogReportData>> {
  const bool = (k: string) => own(input, k) === true || own(input, k) === "on";
  const values: ReportValues = {
    category: text(own(input, "category")),
    site: text(own(input, "site")),
    url: text(own(input, "url")),
    description: text(own(input, "description")),
    name: text(own(input, "name")),
    email: text(own(input, "email")),
    originalWork: text(own(input, "originalWork")),
    goodFaith: bool("goodFaith"),
    accuracy: bool("accuracy"),
    signature: text(own(input, "signature")),
  };
  const noEmail = values.email === "" && values.category !== "copyright";
  const { fieldErrors, report } = validateReport(
    noEmail ? { ...values, email: NO_EMAIL } : values,
  );
  if (!report) {
    const first = Object.keys(fieldErrors)[0] as ReportField | undefined;
    return bad(
      (first && fieldErrors[first]) || "Check the report and try again.",
      first,
    );
  }
  const viaRaw = text(own(input, "receivedVia"));
  const via: ReceivedVia = (RECEIVED_VIA as readonly string[]).includes(viaRaw)
    ? (viaRaw as ReceivedVia)
    : "email";
  const atRaw = text(own(input, "receivedAt"));
  let receivedAt: Date | null = null;
  if (atRaw) {
    receivedAt = fromBusinessLocalInput(atRaw);
    if (!receivedAt) return bad("Pick when it was received.", "receivedAt");
    if (receivedAt.getTime() > Date.now() + 60_000) {
      return bad("Received at can't be in the future.", "receivedAt");
    }
  }
  const dmca = report.category === "copyright" && report.dmcaStatement !== null;
  const reporterEmail = noEmail ? "" : report.reporterEmail;
  const result = await runStaffAction("review_queue", {}, async (ctx) => {
    const c = await staffCreateCase(ctx, {
      kind: dmca ? "dmca" : "report",
      targetUrl: report.targetUrl,
      category: report.category,
      description: report.description,
      reporter:
        report.reporterName || reporterEmail
          ? {
              ...(report.reporterName ? { name: report.reporterName } : {}),
              ...(reporterEmail ? { email: reporterEmail } : {}),
            }
          : null,
      dmcaStatement: report.dmcaStatement,
      receivedVia: via,
      ...(receivedAt ? { receivedAt } : {}),
    });
    return {
      ref: c.ref,
      orgId: c.orgId,
      message: `Case ${c.ref} logged. The owner was not contacted.`,
    };
  });
  if (result.ok) refresh();
  return result;
}
