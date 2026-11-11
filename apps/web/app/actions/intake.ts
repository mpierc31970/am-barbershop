"use server";
// Setup actions (06-18; ONB-01, ONB-02, ONB-03; CONTEXT A3-Q4; 06-UI-SPEC "Setup overview",
// "Stages" autosave contract; T-06-87, T-06-88, T-06-89). Public POST endpoints: every
// argument is untrusted. The tenant, role and impersonation come only from the session
// cookie via runAction; payload keys are allow-listed (lib/intake.ts) and the chokepoint
// validates them again. Business writes are Owner/Admin at the chokepoint (an Editor gets
// the Forbidden copy); Send to CDS is owner-only and refused under staff impersonation.
// Saves refresh the /hub layout, so the sidebar's needed-count follows the answers.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { InvalidInput } from "@cds/core";
import {
  isStageSlug,
  type IntakeAnswers,
  type StageSlug,
} from "@cds/core/intake";
import {
  dismissFirstVisit,
  enqueueAssembly,
  markStageSaved,
  saveBusinessProfile,
  saveIntakeAnswers,
  sendToCds,
  type BusinessProfile,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import { assemblyDeps } from "../../lib/assembly-deps";
import { contentDeps } from "../../lib/content";
import { ANSWER_KEYS, PROFILE_KEYS, pickKeys } from "../../lib/intake";

const SEND_COPY = {
  forbidden: "Only the site owner can send this to Support.",
  impersonation: "Sending to Support is the owner's step.",
};
const SEND_UNLOCK = "Send to Support unlocks when the must-haves are in.";
const SEND_FAILED =
  "Sending didn't finish. Your answers are saved. Try again in a minute.";

function stageOf(raw: unknown): StageSlug {
  if (!isStageSlug(raw)) {
    throw new InvalidInput("That step doesn't exist. Refresh and try again.");
  }
  return raw;
}

function refreshHub(): void {
  try {
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error("[setup] revalidate failed", err);
  }
}

/** Save business profile fields for one step, then mark the step saved. */
export async function saveProfileAction(
  stage: StageSlug,
  patch: Record<string, unknown>,
): Promise<ActionResult<BusinessProfile>> {
  const res = await runAction(async (s) => {
    const step = stageOf(stage);
    // 13-52 (D270): contentDeps() so a live save's publish scan invalidates the site.
    const saved = await saveBusinessProfile(
      s.ctx,
      pickKeys(patch, PROFILE_KEYS),
      contentDeps(),
    );
    await markStageSaved(s.ctx, step);
    return saved;
  });
  if (res.ok) refreshHub();
  return res;
}

/** Save domain / integration answers for one step, then mark the step saved. */
export async function saveAnswersAction(
  stage: StageSlug,
  patch: Record<string, unknown>,
): Promise<ActionResult<IntakeAnswers>> {
  const res = await runAction(async (s) => {
    const step = stageOf(stage);
    const answers = await saveIntakeAnswers(
      s.ctx,
      pickKeys(patch, ANSWER_KEYS),
    );
    await markStageSaved(s.ctx, step);
    return answers;
  });
  if (res.ok) refreshHub();
  return res;
}

/** Record a step as saved (steps whose fields save through their own actions). */
export async function markStageSavedAction(
  stage: StageSlug,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await markStageSaved(s.ctx, stageOf(stage));
    return null;
  });
  if (res.ok) refreshHub();
  return res;
}

/** Hide the first-visit welcome (the owner opened a step). */
export async function dismissFirstVisitAction(): Promise<ActionResult<null>> {
  return runAction(async (s) => {
    await dismissFirstVisit(s.ctx);
    return null;
  });
}

/** Send to CDS: owner only, refused while a must-have is missing. */
export async function sendToCdsAction(): Promise<
  ActionResult<{ submittedAt: string; stage: string }>
> {
  // The org id comes from the session context only, never from input (T-08-17-03).
  let orgId = "";
  const res = await runAction(async (s) => {
    orgId = s.ctx.orgId;
    const r = await sendToCds(s.ctx, ADDON_REGISTRY);
    return { submittedAt: r.submittedAt.toISOString(), stage: r.stage };
  }, SEND_COPY);
  if (res.ok) {
    // 08-17 (CONTEXT A2-Q1): start assembly at once, fire-and-forget; a fit_review stage
    // waits for staff, and the hourly sweep picks the org up after approval.
    // Stays before payment by the P10 decision (10-CONTEXT): the assembled site is a noindex
    // preview; payment sets billing_accounts.paid_at, which CDS build work keys off.
    if (res.data.stage === "ready_for_build" && orgId !== "") {
      enqueueAssembly(orgId, assemblyDeps());
    }
    refreshHub();
    return res;
  }
  if (res.code === "intake_incomplete") {
    return { ok: false, code: res.code, message: SEND_UNLOCK };
  }
  if (res.code === "save_failed" || res.code === "rate_limited") {
    return { ok: false, code: res.code, message: SEND_FAILED };
  }
  return res;
}
