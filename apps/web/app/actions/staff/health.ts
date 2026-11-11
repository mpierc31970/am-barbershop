"use server";
// Health actions (13-45 choice 3; STAFF-14, D155, D269; T-13-45-01, T-13-45-02). Public POST
// endpoints (Server Actions, never a GET): every argument is untrusted. Thin callers of the
// @cds/db functions 13-18 built for the fail-safe inbox:
//   convertFailsafeRequestAction(id)         -> staffConvertFailsafeRequest (audit failsafe.converted)
//   dismissFailsafeRequestAction(id, reason) -> staffDismissFailsafeRequest (audit failsafe.dismissed)
// `failsafe_requests` feature (both roles), no step-up. runStaffAction re-reads the staff
// session and STAFF_MATRIX; the db functions check the matrix again and re-check the state
// right before writing (a second click finds the request handled). Manifests come from
// ADDON_REGISTRY.list() (Invariant 4, P13-P7). Errors are logged by class name only; request
// contents are never logged.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  staffConvertFailsafeRequest,
  staffDismissFailsafeRequest,
  type PlatformContext,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ID_RE = /^[a-z0-9]{15}$/;
const FEATURE = "failsafe_requests";
const REASON_MAX = 200;

const NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That request wasn't found.",
};

export type ConvertFailsafeResult =
  | { converted: true; ref: string; message: string }
  | { converted: false; conflict: string; message: string };

function refresh(): void {
  try {
    revalidatePath("/staff/health");
  } catch (err) {
    console.error("[staff health] revalidate failed", errorName(err));
  }
}

/** One-click convert through the add-on's own convert path; a conflict keeps it pending. */
export async function convertFailsafeRequestAction(
  id: unknown,
): Promise<ActionResult<ConvertFailsafeResult>> {
  const rid = typeof id === "string" && ID_RE.test(id) ? id : null;
  if (!rid) return NOT_FOUND;
  const result = await runStaffAction(
    FEATURE,
    { stepUp: false },
    async (ctx: PlatformContext): Promise<ConvertFailsafeResult> => {
      const out = await staffConvertFailsafeRequest(ctx, rid, {
        manifests: ADDON_REGISTRY.list(),
      });
      return out.converted
        ? {
            converted: true,
            ref: out.ref,
            message: `Converted. Created ${out.ref}.`,
          }
        : {
            converted: false,
            conflict: out.conflict,
            message: out.conflict,
          };
    },
  );
  if (result.ok && result.data.converted) refresh();
  return result;
}

/** Dismiss with a reason (1-200 characters; the reason goes in the audit meta only). */
export async function dismissFailsafeRequestAction(
  id: unknown,
  reason: unknown,
): Promise<ActionResult<{ message: string }>> {
  const rid = typeof id === "string" && ID_RE.test(id) ? id : null;
  if (!rid) return NOT_FOUND;
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text === "" || text.length > REASON_MAX) {
    return {
      ok: false,
      code: "invalid_input",
      message: `Give a reason (up to ${REASON_MAX} characters).`,
      field: "reason",
    };
  }
  const result = await runStaffAction(
    FEATURE,
    { stepUp: false },
    async (ctx: PlatformContext) => {
      await staffDismissFailsafeRequest(ctx, rid, text);
      return { message: "Dismissed." };
    },
  );
  if (result.ok) refresh();
  return result;
}
