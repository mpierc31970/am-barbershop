// Staff Server Action wrapper (13-21 choice 3; RESEARCH Pattern 3; T-13-21-04). Every console
// action runs through runStaffAction: it re-derives the staff session from the cookie, re-checks
// STAFF_MATRIX for the feature (page checks do not protect actions), refuses a step-up action
// whose sign-in is older than 15 minutes with `step_up_needed` (the StepUpDialog then asks for
// a code and retries), and turns failures into fixed copy. Codes the console understands:
//   session_ended   no session or a refused token (SESSION-ENDED); the client goes to sign-in
//   step_up_needed  a fresh emailed code is needed first; `fn` was not called
//   forbidden       the role may not use this (REFUSED-ROLE)
// plus the CdsError codes lib/action.ts maps. Raw errors never reach the browser and are
// logged by class name only. Server-only: reads the staff cookie.
import { authorizeStaff, CdsError } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import type { PlatformContext } from "@cds/db";
import {
  SAVE_FAILED_COPY,
  toActionError,
  type ActionResult,
  type CopyOverride,
} from "./action";
import { getStaffSession, type StaffWebSession } from "./staff-session";

export type { ActionResult };

/** The sign-in outage copy (the member sign-in's UNAVAILABLE line, verbatim). */
export const STAFF_UNAVAILABLE_COPY =
  "We couldn't sign you in just now. Wait a minute, then try again.";

/** Next signals redirect / notFound by throwing; those must pass through untouched. */
export function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/** Class name only: never a body, token, key or address (EXECUTOR-BRIEF). */
export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export function sessionEnded(): Extract<ActionResult<never>, { ok: false }> {
  return { ok: false, code: "session_ended", message: P13_COPY.SESSION_ENDED };
}

export async function runStaffAction<T>(
  feature: string,
  opts: { stepUp?: boolean },
  fn: (ctx: PlatformContext, session: StaffWebSession) => Promise<T>,
  copy: CopyOverride = {},
): Promise<ActionResult<T>> {
  try {
    // Inside the try: an outage while reading the session is a failed result, never a
    // rejected action; only a refused token is session_ended.
    const session = await getStaffSession();
    if (!session) return sessionEnded();
    authorizeStaff(session.ctx.staffRole, feature);
    if (opts.stepUp && !session.stepUpFresh) {
      return { ok: false, code: "step_up_needed", message: "" };
    }
    return { ok: true, data: await fn(session.ctx, session) };
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    if (err instanceof CdsError) {
      return toActionError(err, {
        forbidden: P13_COPY.REFUSED_ROLE,
        impersonation: P13_COPY.REFUSED_ROLE,
        ...copy,
      });
    }
    console.error("[staff action] failed", errorName(err));
    return { ok: false, code: "save_failed", message: SAVE_FAILED_COPY };
  }
}
