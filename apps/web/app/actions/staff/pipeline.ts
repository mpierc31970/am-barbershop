"use server";
// Pipeline actions (13-27; STAFF-01, STAFF-03, STAFF-04; D26, D29; P13-P11; RESEARCH Pitfalls
// 4-5; T-13-27-01..03). Public POST endpoints: every argument is untrusted. Each action is a
// thin caller of the exact @cds/db function its CLI calls, so the console can never drift from
// the CLI rules:
//   fit:review   -> approveFit / declineFit          (fit_review, super_admin, step-up)
//   org:decline  -> declinePaidOrg                   (org_decline, super_admin, step-up)
//   org:stage    -> setOrgStage / setBuildNote       (org_stage super_admin; console moves
//                                                     reach the build stages only, launch is
//                                                     Approve launch (WR-C03); build_note
//                                                     agents too)
//   site:assemble --rerun -> assembleSiteAsStaff     (site_assemble, agents too)
//   Reveal email -> revealLeadEmail                  (lead_reveal, audited)
// runStaffAction re-reads the staff session and STAFF_MATRIX before any call; the @cds/db
// functions check the matrix again and write the audit rows. A site in fit review is never
// moved through setOrgStage (Pitfall 5). P14 (14-36) supersedes P13-P11: Approve launch needs
// the owner's submitted launch review (P14-P35, no override) and a prepared domain move, then
// starts steps 6-10 through startCutover; the cutover step sets the stage (D26, Pitfall 12).
// Open change tickets still need "Launch anyway". Result lines mirror the CLIs.
// Errors are logged by class name only.
import { InvalidInput } from "@cds/core";
import { P14_COPY, STAFF_STEP_WORDS } from "@cds/core/dns";
import { formatCentsExact } from "@cds/core/pricing";
import {
  assembleSiteAsStaff,
  approveFit,
  BUILD_NOTE_MAX,
  declineFit,
  declinePaidOrg,
  DECLINE_NOTE_MAX,
  DECLINE_REASON_CATEGORIES,
  rerunLines,
  revealLeadEmail,
  setBuildNote,
  setOrgStage,
  startCutover,
  staffLaunchQueue,
  staffOrgStage,
  staffPolishQueue,
  type DeclineReasonCategory,
  type OrgStage,
  type PlatformContext,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { assemblyDeps } from "../../../lib/assembly-deps";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ORG_RE = /^[a-z0-9]{15}$/;
const LEAD_RE = /^[a-z0-9]{1,32}$/i;
const REASON_MIN = 3;
const REASON_MAX = 500;
const FINGERPRINT_MAX = 256;
/** Stages a console move may target (same list the org:stage CLI accepts). */
const STAGES = [
  "intake",
  "fit_review",
  "ready_for_build",
  "being_built",
  "ready_for_review",
  "live",
] as const;
type Stage = (typeof STAGES)[number];
/**
 * Stages a console stage move may target (WR-C03). `live` goes only through
 * approveLaunchAction (ready_for_review + the open-change-requests gate); `fit_review` never
 * (fit holds are created by the fit check, with their case).
 */
const CONSOLE_MOVE_TARGETS = [
  "ready_for_build",
  "being_built",
  "ready_for_review",
] as const satisfies readonly Stage[];
/** Only Approve launch (a prepared move's cutover) takes a site live (Pitfall 12). */
const LIVE: Stage = "live";
const LAUNCH_VIA_APPROVE = "Launch a site with Approve launch in the pipeline.";

const SITE_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That site wasn't found.",
};
const LEAD_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That lead wasn't found.",
};

// CLI result lines (fit-review.ts, org-stage.ts, site-assemble.ts), verbatim where they fit a
// browser; command hints are dropped.
const APPROVED = "Approved. The owner can go to checkout when it opens.";
const ASSEMBLY_SOON = "Assembly runs within the hour.";
const DECLINED = "Declined. The owner was emailed and the site is held.";
const NOT_SENT =
  "This site hasn't been sent to CDS yet, so there's nothing to assemble.";
const BUSY =
  "Assembly is already running for this site. Try again in a few minutes.";
const NOT_IN_REVIEW = "This site isn't waiting for launch.";
const NOT_SUBMITTED = "The owner hasn't sent the review yet.";
const NO_DOMAIN = "Connect a domain first: the site has no domain.";
const NOT_ASSEMBLED =
  "This site isn't assembled and being polished, so it can't go to review yet.";

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

function orgOf(raw: unknown): string | null {
  return typeof raw === "string" && ORG_RE.test(raw) ? raw : null;
}

function reasonOf(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text.length >= REASON_MIN && text.length <= REASON_MAX ? text : null;
}

const REASON_COPY = `Write a reason of ${REASON_MIN} to ${REASON_MAX} characters.`;

function refresh(): void {
  try {
    revalidatePath("/staff", "layout");
  } catch (err) {
    console.error("[staff pipeline] revalidate failed", errorName(err));
  }
}

function changeTicketsLine(n: number): string {
  return n === 1
    ? "1 change request is still open."
    : `${n} change requests are still open.`;
}

// ------------------------------------------------------------------- fit holds (STAFF-03)

export type PipelineResult = { message: string };

/**
 * Approve fit (fit:review --approve). `input` = `{ reason, reviewed, overrideBlocked? }`:
 * `reviewed` is the case fingerprint the console showed (staffFitHolds), so a case changed
 * since is refused (R2-CR-01); a blocked verdict needs `overrideBlocked` (--override-blocked).
 */
export async function approveFitAction(
  orgId: unknown,
  input: unknown,
): Promise<ActionResult<PipelineResult & { readyForBuild: boolean }>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const reason = reasonOf(own(input, "reason"));
  if (!reason) return bad(REASON_COPY, "reason");
  const reviewed = own(input, "reviewed");
  if (
    typeof reviewed !== "string" ||
    reviewed === "" ||
    reviewed.length > FINGERPRINT_MAX
  ) {
    return bad("Reload the page to see the latest case, then try again.");
  }
  const overrideBlocked = own(input, "overrideBlocked") === true;
  const result = await runStaffAction(
    "fit_review",
    { stepUp: true },
    async (ctx) => {
      await approveFit(ctx, org, reason, { reviewed, overrideBlocked });
      // P8: an org whose intake was already sent lands on ready_for_build (best effort read).
      let readyForBuild = false;
      try {
        readyForBuild =
          (await staffOrgStage(ctx, org)).stage === "ready_for_build";
      } catch (err) {
        console.error("[staff pipeline] stage read failed", errorName(err));
      }
      return {
        message: readyForBuild ? `${APPROVED} ${ASSEMBLY_SOON}` : APPROVED,
        readyForBuild,
      };
    },
  );
  if (result.ok) refresh();
  return result;
}

/**
 * Decline fit (fit:review --decline) for a site held before payment. `input` =
 * `{ reasonCategory: fit|capacity|scope|other, note? }` (UI-SPEC radio + note; other needs the
 * note); the audit reason is "category: note".
 */
export async function declineFitAction(
  orgId: unknown,
  input: unknown,
): Promise<ActionResult<PipelineResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const parsed = declineInputOf(input);
  if ("ok" in parsed) return parsed;
  const reason = parsed.note
    ? `${parsed.category}: ${parsed.note}`
    : parsed.category;
  const result = await runStaffAction(
    "fit_review",
    { stepUp: true },
    async (ctx) => {
      await declineFit(ctx, org, reason);
      return { message: DECLINED };
    },
  );
  if (result.ok) refresh();
  return result;
}

function declineInputOf(
  input: unknown,
): { category: DeclineReasonCategory; note: string } | Failure {
  const category = own(input, "reasonCategory");
  if (
    typeof category !== "string" ||
    !(DECLINE_REASON_CATEGORIES as readonly string[]).includes(category)
  ) {
    return bad(
      "Pick a reason: Fit, Capacity, Scope or Other.",
      "reasonCategory",
    );
  }
  const rawNote = own(input, "note");
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (note.length > DECLINE_NOTE_MAX) {
    return bad(`Keep the note to ${DECLINE_NOTE_MAX} characters.`, "note");
  }
  if (/[\r\n]/.test(note)) return bad("Keep the note to one sentence.", "note");
  if (category === "other" && note === "") {
    return bad("Other needs a one-sentence note to the owner.", "note");
  }
  return { category: category as DeclineReasonCategory, note };
}

/**
 * Decline a paid order (org:decline): full refund, site closed, owner emailed. `input` =
 * `{ reasonCategory, note? }`. Refusals (outside the window, build started) are the
 * chokepoint's DeclineRefused copy.
 */
export async function declinePaidOrderAction(
  orgId: unknown,
  input: unknown,
): Promise<
  ActionResult<PipelineResult & { refundedCents: number; deleteOn: string }>
> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const parsed = declineInputOf(input);
  if ("ok" in parsed) return parsed;
  const result = await runStaffAction(
    "org_decline",
    { stepUp: true },
    async (ctx) => {
      const r = await declinePaidOrg(ctx, org, {
        reasonCategory: parsed.category,
        note: parsed.note === "" ? null : parsed.note,
      });
      return {
        message: `Declined and refunded ${formatCentsExact(r.refundedCents)}. ${r.emailed ? "Owner emailed." : "Owner email not sent (logged)."} Site data deletes on ${r.deleteOn}.`,
        refundedCents: r.refundedCents,
        deleteOn: r.deleteOn,
      };
    },
  );
  if (result.ok) refresh();
  return result;
}

// --------------------------------------------------------- stage moves (STAFF-03, STAFF-04)

type StageResult = PipelineResult & {
  from: OrgStage;
  to: Stage;
  changed: boolean;
  launchedAt: string | null;
};

async function moveStage(
  ctx: PlatformContext,
  org: string,
  from: OrgStage,
  to: Stage,
): Promise<StageResult> {
  const r = await setOrgStage(ctx, org, to);
  return {
    message: r.changed
      ? `Stage moved: ${from || "(no stage)"} -> ${to}.`
      : `Already ${to}.`,
    from,
    to,
    changed: r.changed,
    launchedAt: r.launchedAt,
  };
}

/**
 * Set stage forward (org:stage --to) to a build stage only (WR-C03): `live` is refused here
 * (Approve launch is the gated path) and `fit_review` is never a target. super_admin. Backward
 * moves, held and closed sites are refused by setOrgStage itself.
 */
export async function moveStageAction(
  orgId: unknown,
  to: unknown,
): Promise<ActionResult<StageResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  if (typeof to !== "string" || !(STAGES as readonly string[]).includes(to)) {
    return bad("Pick a stage.", "to");
  }
  if (to === LIVE) return bad(LAUNCH_VIA_APPROVE, "to");
  if (!(CONSOLE_MOVE_TARGETS as readonly string[]).includes(to)) {
    return bad("Pick a stage.", "to");
  }
  const target = to as Stage;
  const result = await runStaffAction("org_stage", {}, async (ctx) => {
    const cur = await staffOrgStage(ctx, org);
    if (cur.stage === "fit_review") {
      throw new InvalidInput(
        "This site is in fit review. Approve or decline it under Fit holds.",
      );
    }
    return moveStage(ctx, org, cur.stage, target);
  });
  if (result.ok) refresh();
  return result;
}

export type LaunchResult = PipelineResult & {
  /** The move's display code (`M-<seq>`). */
  move: string;
  /** The move status after the synchronous first run (`cutover_running`, `done`, `failed`). */
  status: string;
};

/**
 * Approve launch (STAFF-03, D26; 14-36). super_admin + step-up. The site must be in
 * ready_for_review, the owner must have sent the launch review (P14-P35, no override) and the
 * site's domain move must be `prepared`; open change tickets refuse unless
 * `{ launchAnyway: true }`. Then startCutover runs steps 6-10 of the move; the cutover step
 * sets the stage to live (never setOrgStage here: RESEARCH Pitfall 12). A failed cutover
 * leaves the site in review on its preview address; staff see it on Site › Domain, and the
 * toast says which step stopped (WR-C03).
 */
export async function approveLaunchAction(
  orgId: unknown,
  input?: unknown,
): Promise<ActionResult<LaunchResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const launchAnyway = own(input, "launchAnyway") === true;
  const result = await runStaffAction(
    "org_stage",
    { stepUp: true },
    async (ctx): Promise<LaunchResult | { openChanges: number }> => {
      const cur = await staffOrgStage(ctx, org);
      if (cur.stage !== "ready_for_review")
        throw new InvalidInput(NOT_IN_REVIEW);
      const row = (await staffLaunchQueue(ctx)).find((r) => r.orgId === org);
      // WR-C03: no launch-queue row is never read as "0 open change requests".
      if (!row) throw new InvalidInput(NOT_IN_REVIEW);
      // P14-P35: the owner's Ready to launch is the D172 gate; staff cannot override it.
      if (!row.review.submittedAt) throw new InvalidInput(NOT_SUBMITTED);
      // CR-D01: a send older than a page change is stale (the owner re-sends).
      if (row.review.resubmitNeeded.length > 0) {
        throw new InvalidInput(
          P14_COPY.APPROVE_RESEND({ count: row.review.resubmitNeeded.length }),
        );
      }
      if (row.move.state === "none") throw new InvalidInput(NO_DOMAIN);
      if (row.move.state !== "prepared") {
        throw new InvalidInput(
          P14_COPY.APPROVE_BLOCKED({
            waitingOn: row.move.waitingOn ?? "the move is not prepared",
          }),
        );
      }
      const open = row.openChangeTickets;
      if (open > 0 && !launchAnyway) return { openChanges: open };
      const view = await startCutover(ctx, org);
      // WR-C03: the toast follows the move after the first run, so a failed step never
      // reads as "Launching".
      const business = cur.orgName || "the site";
      const message =
        view.status === "failed"
          ? P14_COPY.APPROVE_STOPPED({
              business,
              step: STAFF_STEP_WORDS[view.failedStep ?? view.currentStep],
            })
          : view.status === "done"
            ? P14_COPY.APPROVE_LIVE({ business })
            : P14_COPY.APPROVE_LAUNCHING({ business });
      return { message, move: view.code, status: view.status };
    },
  );
  if (!result.ok) return result;
  if ("openChanges" in result.data) {
    return bad(
      `${changeTicketsLine(result.data.openChanges)} Tick Launch anyway to go ahead.`,
      "launchAnyway",
    );
  }
  refresh();
  return { ok: true, data: result.data };
}

/**
 * Mark ready for owner review (STAFF-04): an assembled being_built site (it is in the polish
 * queue) moves to ready_for_review. Same matrix as org:stage --to (super_admin); no step-up.
 */
export async function markReadyForReviewAction(
  orgId: unknown,
): Promise<ActionResult<StageResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const result = await runStaffAction("org_stage", {}, async (ctx) => {
    const queued = (await staffPolishQueue(ctx)).some((r) => r.orgId === org);
    if (!queued) throw new InvalidInput(NOT_ASSEMBLED);
    const cur = await staffOrgStage(ctx, org);
    const moved = await moveStage(ctx, org, cur.stage, "ready_for_review");
    return {
      ...moved,
      message: `${cur.orgName || "The site"} is ready for review.`,
    };
  });
  if (result.ok) refresh();
  return result;
}

// --------------------------------------------------------------- building (STAFF-01)

export type RerunResult = PipelineResult & {
  status: "done" | "already";
  lines: string[];
  previewHost: string | null;
};

/** Re-run assembly (site:assemble --rerun): edited pages are left alone, deleted not recreated. */
export async function rerunAssemblyAction(
  orgId: unknown,
): Promise<ActionResult<RerunResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const result = await runStaffAction("site_assemble", {}, (ctx) =>
    assembleSiteAsStaff(ctx, org, { rerun: true }, assemblyDeps()),
  );
  if (!result.ok) return result;
  const r = result.data;
  switch (r.status) {
    case "not_ready":
      return bad(NOT_SENT);
    case "busy":
      return bad(BUSY);
    case "no_template":
      return bad(
        "There is no template for this site's path yet, so there's nothing to assemble.",
      );
    case "failed": {
      const code = r.ledger.error?.code ?? r.errorCode ?? "FAILED";
      const page = r.ledger.error?.page;
      return bad(
        `Assembly failed: ${code}${page ? ` on ${page}` : ""}. Fix the cause, then re-run. It picks up where it stopped and never duplicates a page.`,
      );
    }
    case "already":
      refresh();
      return {
        ok: true,
        data: {
          status: "already",
          message: "Already assembled. Nothing was rebuilt.",
          lines: [],
          previewHost: r.previewHost,
        },
      };
    case "done":
      break;
  }
  refresh();
  const lines = r.report ? rerunLines(r.report) : [];
  return {
    ok: true,
    data: {
      status: "done",
      message: lines[lines.length - 1] ?? "Assembly re-run.",
      lines,
      previewHost: r.previewHost,
    },
  };
}

/**
 * Edit note (org:stage --build-note / --clear-note): the "What CDS is doing now" line the
 * owner reads on Today. `note` null or "" clears it. super_admin or support_agent.
 */
export async function saveBuildNoteAction(
  orgId: unknown,
  note: unknown,
): Promise<ActionResult<PipelineResult & { note: string }>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  if (note !== null && note !== undefined && typeof note !== "string") {
    return bad("Write the note as text.", "note");
  }
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > BUILD_NOTE_MAX) {
    return bad(`Keep the note to ${BUILD_NOTE_MAX} characters.`, "note");
  }
  if (/[\r\n]/.test(text)) return bad("Keep the note to one line.", "note");
  const result = await runStaffAction("build_note", {}, async (ctx) => {
    await setBuildNote(ctx, org, text);
    return {
      message: text
        ? "Done. The owner sees the new note under What CDS is doing now on Today."
        : "Done. Today shows the default line again.",
      note: text,
    };
  });
  if (result.ok) refresh();
  return result;
}

// ------------------------------------------------------------------- leads (STAFF-01)

/** Reveal email (P13-P22): the lead's address, audited `lead.email_revealed` by @cds/db. */
export async function revealLeadEmailAction(
  leadId: unknown,
): Promise<ActionResult<{ email: string }>> {
  if (typeof leadId !== "string" || !LEAD_RE.test(leadId)) {
    return LEAD_NOT_FOUND;
  }
  const result = await runStaffAction("lead_reveal", {}, async (ctx) => ({
    email: await revealLeadEmail(ctx, leadId),
  }));
  if (!result.ok && result.code === "not_found") return LEAD_NOT_FOUND;
  return result;
}
