"use client";
// useStaffAction (13-09; STAFF-06; RESEARCH Pitfall 12: the step-up dialog never loses the
// action). Wraps one staff server action. `run(...args)`:
// 1. calls `action(...args)`;
// 2. on `{ ok:false, code:"step_up_needed" }` opens the provider's StepUpDialog
//    ("Then: {describe(args)}"); when the code is confirmed it re-invokes the SAME function
//    with the SAME arguments exactly once (T-13-09-02; the server re-checks freshness, and a
//    second step_up_needed is returned as is, never looped); when the person stops, the
//    original result is returned;
// 3. on `session_ended` (first call or retry) sends the browser to
//    /staff/sign-in?next=<current path>;
// 4. resolves the final StaffActionResult, so the caller (usually a CaseDialog) keeps its
//    inputs and shows any refusal where the action was.
// 5. never rejects for the action itself (WR-D06): a network drop, a 500 or an action that
//    throws (outages are rethrown on purpose) resolves `{ ok:false, code:"network",
//    message: ERR_SEND }`, so every caller degrades the same way and no rejection goes
//    unhandled.
import { P13_COPY } from "@cds/core/staff";
import { useCallback, useContext, useEffect, useRef } from "react";
import {
  StaffActionContext,
  type StaffActionResult,
} from "./StaffActionProvider";

/** WR-D06: the result a thrown or failed-to-send action resolves to. */
export const STAFF_NETWORK_CODE = "network";

/** Next's redirect / notFound are control flow, not failures: callers that catch let them through. */
export function rethrowControlFlow(err: unknown): void {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;
}

async function settle<A extends unknown[], T>(
  fn: (...args: A) => Promise<StaffActionResult<T>>,
  args: A,
): Promise<StaffActionResult<T>> {
  try {
    return await fn(...args);
  } catch (err) {
    rethrowControlFlow(err);
    return { ok: false, code: STAFF_NETWORK_CODE, message: P13_COPY.ERR_SEND };
  }
}

export interface UseStaffActionOptions<A extends unknown[]> {
  /** The pending action for the dialog's "Then:" line ("Approve launch for Rivera Bakery"). */
  describe?: (args: A) => string;
}

export function useStaffAction<A extends unknown[], T>(
  action: (...args: A) => Promise<StaffActionResult<T>>,
  options: UseStaffActionOptions<A> = {},
): (...args: A) => Promise<StaffActionResult<T>> {
  const ctx = useContext(StaffActionContext);
  const actionRef = useRef(action);
  const describeRef = useRef(options.describe);
  useEffect(() => {
    actionRef.current = action;
    describeRef.current = options.describe;
  });
  const stepUp = ctx?.stepUp;
  const signInAgain = ctx?.signInAgain;

  return useCallback(
    async (...args: A): Promise<StaffActionResult<T>> => {
      if (!stepUp || !signInAgain) {
        throw new Error("useStaffAction needs a StaffActionProvider above it");
      }
      const fn = actionRef.current;
      const first = await settle(fn, args);
      if (first.ok) return first;
      if (first.code === "session_ended") {
        signInAgain();
        return first;
      }
      if (first.code !== "step_up_needed") return first;
      const confirmed = await stepUp(describeRef.current?.(args));
      if (!confirmed) return first;
      const retry = await settle(fn, args);
      if (!retry.ok && retry.code === "session_ended") signInAgain();
      return retry;
    },
    [stepUp, signInAgain],
  );
}
