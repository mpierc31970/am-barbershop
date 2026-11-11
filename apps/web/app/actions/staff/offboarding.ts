"use server";
// Staff offboarding actions (14-43 choice 4; LIFE-01, D282, P14-P13; T-14-43-01, T-14-43-02).
// Public POST endpoints (Server Actions, never a GET): every argument is untrusted and is
// narrowed before the staff session is read. Thin callers of the @cds/db functions that
// `npm run org:offboard` uses too (offboarding/staff.ts, 14-40):
//   startOffboardingAction(org, reason)  -> staffStartOffboarding  (offboard, step-up)
//   cancelOffboardingAction(org, reason) -> staffCancelOffboarding (offboard, step-up)
//   rerunHandbackAction(org)             -> staffRerunHandback     (domains, both roles)
// runStaffAction re-reads the staff session and STAFF_MATRIX before any call and refuses a
// step-up action without a fresh sign-in (`step_up_needed`); the db functions check the
// matrix again and audit in the same batch (reason required). Errors are logged by class
// name only.
import {
  staffCancelOffboarding,
  staffRerunHandback,
  staffStartOffboarding,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;
export type StaffOffboardingActionResult = { message: string };

const ORG_RE = /^[a-z0-9]{15}$/;
const REASON_MIN = 3;
const REASON_MAX = 500;

const SITE_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That site wasn't found.",
};

const COPY = {
  reason: `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`,
  started: "Offboarding started. The owner was emailed the checklist.",
  cancelled: "Offboarding cancelled. Their plan and price carry on.",
  rerun: (n: number) =>
    `Handback check re-run for ${n} ${n === 1 ? "domain" : "domains"}.`,
} as const;

function orgOf(raw: unknown): string | null {
  return typeof raw === "string" && ORG_RE.test(raw) ? raw : null;
}

function reasonOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const r = raw.trim();
  return r.length >= REASON_MIN && r.length <= REASON_MAX ? r : null;
}

function badReason(): Failure {
  return {
    ok: false,
    code: "invalid_input",
    message: COPY.reason,
    field: "reason",
  };
}

function refresh(org: string): void {
  try {
    revalidatePath(`/staff/sites/${org}`);
  } catch (err) {
    console.error("[staff offboarding] revalidate failed", errorName(err));
  }
}

/** Start the 30-day notice for a site (super_admin, step-up; reason 3-500). */
export async function startOffboardingAction(
  orgId: unknown,
  reason: unknown,
): Promise<ActionResult<StaffOffboardingActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const why = reasonOf(reason);
  if (!why) return badReason();
  const result = await runStaffAction(
    "offboard",
    { stepUp: true },
    async (ctx) => {
      await staffStartOffboarding(ctx, org, { reason: why });
      return { message: COPY.started };
    },
  );
  if (result.ok) refresh(org);
  return result;
}

/** Cancel a running notice (super_admin, step-up; reason 3-500). */
export async function cancelOffboardingAction(
  orgId: unknown,
  reason: unknown,
): Promise<ActionResult<StaffOffboardingActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const why = reasonOf(reason);
  if (!why) return badReason();
  const result = await runStaffAction(
    "offboard",
    { stepUp: true },
    async (ctx) => {
      await staffCancelOffboarding(ctx, org, why);
      return { message: COPY.cancelled };
    },
  );
  if (result.ok) refresh(org);
  return result;
}

/** Re-run the DNS handback check for every zone in the handback (both staff roles). */
export async function rerunHandbackAction(
  orgId: unknown,
): Promise<ActionResult<StaffOffboardingActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const result = await runStaffAction("domains", {}, async (ctx) => {
    const zones = await staffRerunHandback(ctx, org);
    return { message: COPY.rerun(zones.length) };
  });
  if (result.ok) refresh(org);
  return result;
}
