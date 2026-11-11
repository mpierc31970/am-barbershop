"use server";
// Staff domain actions (14-51 choice 2; DOM-08, DOM-05, D169; D-UI-P14-18, P14-P13;
// T-14-51-01). Public POST endpoints (Server Actions, never a GET): every argument is
// untrusted. Thin callers of the exact @cds/db functions `domains:move` and the staff
// console share (dns/staff.ts, 14-37):
//   retryStepAction(org)              -> staffRetryStep         (domains, both roles)
//   retakeSnapshotAction(org)         -> staffRetakeSnapshot    (domains, both roles)
//   rerunPostSwitchAction(org)        -> staffRerunPostSwitch   (domains, both roles)
//   addZoneFileAction(org, text)      -> staffAddZoneFile       (domains, both roles)
//   cancelMoveAction(org, reason)     -> staffCancelMove        (domain_move, step-up)
//   overrideGateAction(org, rule, r)  -> staffOverrideGate      (domain_override, step-up)
//   startMoveAction(org, {domain, r}) -> staffStartMove         (domain_move, step-up)
// runStaffAction re-reads the staff session and STAFF_MATRIX before any call and refuses a
// step-up action without a fresh sign-in (`step_up_needed`); the db functions check the
// matrix again and write the audit rows. Errors are logged by class name only.
import { GATE_RULES, type GateRule } from "@cds/core/dns";
import {
  staffAddZoneFile,
  staffCancelMove,
  staffOverrideGate,
  staffRerunPostSwitch,
  staffRetakeSnapshot,
  staffRetryStep,
  staffStartMove,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;
export type StaffDomainActionResult = { message: string };

const ORG_RE = /^[a-z0-9]{15}$/;
const RULE_RE = /^G[1-7]$/;
const REASON_MAX = 500;
/**
 * Cancel, Override and Move domain: 10-500 characters. The plan sketch said 3-500 for cancel;
 * 14-37's staffCancelMove and 14-38's dialog both ask for 10, so the console matches them.
 */
const REASON_MIN = 10;
const DOMAIN_MAX = 253;
/** 256 KiB, the owner upload's cap (P14_COPY.ZONE_TOO_BIG). Not exported ("use server"). */
const STAFF_ZONE_FILE_MAX_BYTES = 256 * 1024;

const SITE_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That site wasn't found.",
};

const COPY = {
  reason: (min: number) =>
    `Give a reason of ${min} to ${REASON_MAX} characters.`,
  rule: "That gate rule wasn't found.",
  domain: "Enter the new domain.",
  zoneEmpty: "Choose a zone file.",
  zoneTooBig: "Zone files must be 256 KB or smaller.",
  retried: "Step retried.",
  retaken: "Snapshot re-taken. The copy and gate run again.",
  zoneAdded: "Zone file added. The copy and gate run again.",
  rerun: "Post-switch check re-run.",
  cancelled: "Move cancelled.",
  overridden: (rule: string) => `${rule} overridden.`,
} as const;

function bad(message: string, field?: string): Failure {
  return field
    ? { ok: false, code: "invalid_input", message, field }
    : { ok: false, code: "invalid_input", message };
}

function orgOf(raw: unknown): string | null {
  return typeof raw === "string" && ORG_RE.test(raw) ? raw : null;
}

function reasonOf(raw: unknown, min: number): string | null {
  if (typeof raw !== "string") return null;
  const r = raw.trim();
  return r.length >= min && r.length <= REASON_MAX ? r : null;
}

function own(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  return Object.prototype.hasOwnProperty.call(input, key)
    ? (input as Record<string, unknown>)[key]
    : undefined;
}

function ruleOf(raw: unknown): GateRule | null {
  if (typeof raw !== "string" || !RULE_RE.test(raw)) return null;
  return (GATE_RULES as readonly string[]).includes(raw)
    ? (raw as GateRule)
    : null;
}

function refresh(org: string): void {
  try {
    revalidatePath(`/staff/sites/${org}`);
  } catch (err) {
    console.error("[staff domains] revalidate failed", errorName(err));
  }
}

async function bothRoles(
  org: string,
  fn: (ctx: Parameters<typeof staffRetryStep>[0]) => Promise<unknown>,
  message: string,
): Promise<ActionResult<StaffDomainActionResult>> {
  const result = await runStaffAction("domains", {}, async (ctx) => {
    await fn(ctx);
    return { message };
  });
  if (result.ok) refresh(org);
  return result;
}

/** Retry the open move's current step. */
export async function retryStepAction(
  orgId: unknown,
): Promise<ActionResult<StaffDomainActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  return bothRoles(org, (ctx) => staffRetryStep(ctx, org), COPY.retried);
}

/** Re-take the snapshot (then copy and gate again). */
export async function retakeSnapshotAction(
  orgId: unknown,
): Promise<ActionResult<StaffDomainActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  return bothRoles(org, (ctx) => staffRetakeSnapshot(ctx, org), COPY.retaken);
}

/** Re-run the post-switch check (step 5) after a mismatch. */
export async function rerunPostSwitchAction(
  orgId: unknown,
): Promise<ActionResult<StaffDomainActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  return bothRoles(org, (ctx) => staffRerunPostSwitch(ctx, org), COPY.rerun);
}

/**
 * Add a zone file read in the browser (MoveTimeline's drawer). The same 256 KiB cap and
 * errors as the upload route; the db function parses it.
 */
export async function addZoneFileAction(
  orgId: unknown,
  text: unknown,
): Promise<ActionResult<StaffDomainActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  if (typeof text !== "string" || text.trim() === "") {
    return bad(COPY.zoneEmpty, "file");
  }
  if (Buffer.byteLength(text, "utf8") > STAFF_ZONE_FILE_MAX_BYTES) {
    return bad(COPY.zoneTooBig, "file");
  }
  return bothRoles(
    org,
    (ctx) => staffAddZoneFile(ctx, org, text),
    COPY.zoneAdded,
  );
}

/** Cancel the open move (super_admin, step-up; reason 10-500). */
export async function cancelMoveAction(
  orgId: unknown,
  reason: unknown,
): Promise<ActionResult<StaffDomainActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const why = reasonOf(reason, REASON_MIN);
  if (!why) return bad(COPY.reason(REASON_MIN), "reason");
  const result = await runStaffAction(
    "domain_move",
    { stepUp: true },
    async (ctx) => {
      const move = await staffCancelMove(ctx, org, why);
      return { message: move.cancelNote ?? COPY.cancelled };
    },
  );
  if (result.ok) refresh(org);
  return result;
}

/** Override one gate rule (super_admin, step-up; reason 10-500). */
export async function overrideGateAction(
  orgId: unknown,
  rule: unknown,
  reason: unknown,
): Promise<ActionResult<StaffDomainActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const r = ruleOf(rule);
  if (!r) return bad(COPY.rule, "rule");
  const why = reasonOf(reason, REASON_MIN);
  if (!why) return bad(COPY.reason(REASON_MIN), "reason");
  const result = await runStaffAction(
    "domain_override",
    { stepUp: true },
    async (ctx) => {
      await staffOverrideGate(ctx, org, r, why);
      return { message: COPY.overridden(r) };
    },
  );
  if (result.ok) refresh(org);
  return result;
}

/** Move a live site to a new domain (super_admin, step-up; reason 10-500). */
export async function startMoveAction(
  orgId: unknown,
  input: unknown,
): Promise<ActionResult<StaffDomainActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const domain = own(input, "domain");
  if (
    typeof domain !== "string" ||
    domain.trim() === "" ||
    domain.length > DOMAIN_MAX
  ) {
    return bad(COPY.domain, "domain");
  }
  const why = reasonOf(own(input, "reason"), REASON_MIN);
  if (!why) return bad(COPY.reason(REASON_MIN), "reason");
  const result = await runStaffAction(
    "domain_move",
    { stepUp: true },
    async (ctx) => {
      const out = await staffStartMove(ctx, org, {
        domain: domain.trim(),
        reason: why,
      });
      return { message: out.message };
    },
  );
  if (result.ok) refresh(org);
  return result;
}
