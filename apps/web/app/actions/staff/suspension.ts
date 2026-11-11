"use server";
// Site suspension actions (13-43 choice 4; STAFF-22; D215, D218; T-13-43-01). Public POST
// endpoints: every argument is untrusted. Each is a thin caller of the @cds/db function 13-17
// built (the console is a new caller; nothing is re-implemented here):
//   sendNoticeAction      -> staffSendSuspensionNotice (suspend_notice, both roles)
//   suspendNowAction      -> staffSuspendNow           (suspend_now, super_admin, step-up)
//   markFixedAction       -> staffMarkFixed            (suspend_notice, both roles)
//   liftSuspensionAction  -> staffLiftSuspension       (suspend_lift, super_admin, step-up)
// runStaffAction re-reads the staff session and STAFF_MATRIX and refuses a stale sign-in with
// step_up_needed before any call; @cds/db checks the matrix again and writes the audit row,
// the owner's CDS note, email and alert. Web callers pass `nextInvalidator` so a suspended or
// lifted site's cached pages are dropped at once. Errors are logged by class name only.
import {
  SUSPENSION_TEXT_MAX,
  staffLiftSuspension,
  staffMarkFixed,
  staffSendSuspensionNotice,
  staffSupportLabels,
  staffSuspendNow,
  type PlatformContext,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { nextInvalidator } from "../../../lib/invalidator";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const ORG_RE = /^[a-z0-9]{15}$/;
/** A notice: hosting rules or a copyright claim (13-17 NOTICE_CATEGORIES). */
const NOTICE_CATEGORIES = ["guideline", "dmca"] as const;
/** Suspend now: illegal content, a legal demand or a copyright claim (IMMEDIATE_CATEGORIES). */
const SUSPEND_CATEGORIES = ["illegal", "legal_demand", "dmca"] as const;

const SITE_NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That site wasn't found.",
};

export type SuspensionActionResult = { message: string };
export type NoticeActionResult = SuspensionActionResult & { fixBy: string };

function own(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function bad(message: string, field: string): Failure {
  return { ok: false, code: "invalid_input", message, field };
}

function orgOf(raw: unknown): string | null {
  return typeof raw === "string" && ORG_RE.test(raw) ? raw : null;
}

/** Trimmed text up to SUSPENSION_TEXT_MAX; "" when absent; null when too long or not text. */
function textOf(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > SUSPENSION_TEXT_MAX ? null : t;
}

const TOO_LONG = `Keep it to ${SUSPENSION_TEXT_MAX.toLocaleString("en-US")} characters.`;

async function businessOf(
  ctx: PlatformContext,
  orgId: string,
): Promise<string> {
  try {
    const labels = await staffSupportLabels(ctx, { orgIds: [orgId] });
    return labels.orgs[orgId]?.trim() || "The site";
  } catch (err) {
    console.error(
      "[staff suspension] business name read failed",
      errorName(err),
    );
    return "The site";
  }
}

/** "Thu 16 Oct" in Central (the toast; the dialog shows the time too). */
function fixByDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Chicago",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

function refresh(org: string): void {
  try {
    revalidatePath(`/staff/sites/${org}`);
    revalidatePath("/staff/sites");
  } catch (err) {
    console.error("[staff suspension] revalidate failed", errorName(err));
  }
}

/**
 * Send a notice to fix (both roles). `input` = `{ category: "guideline" | "dmca", message
 * (what to fix; the owner reads it), note? (staff-only) }`. The site has 3 days.
 */
export async function sendNoticeAction(
  orgId: unknown,
  input: unknown,
): Promise<ActionResult<NoticeActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const category = own(input, "category");
  if (!(NOTICE_CATEGORIES as readonly unknown[]).includes(category)) {
    return bad("Pick a category.", "category");
  }
  const message = textOf(own(input, "message"));
  if (message === null) return bad(TOO_LONG, "message");
  if (message === "") return bad("Write what the owner should fix.", "message");
  const note = textOf(own(input, "note"));
  if (note === null) return bad(TOO_LONG, "note");

  const result = await runStaffAction("suspend_notice", {}, async (ctx) => {
    const r = await staffSendSuspensionNotice(
      ctx,
      {
        orgId: org,
        category: category as string,
        message,
        ...(note ? { note } : {}),
      },
      { invalidator: nextInvalidator },
    );
    const business = await businessOf(ctx, org);
    const fixBy = r.fixBy ?? "";
    return {
      message: `Notice sent to ${business}. Fix by ${fixByDay(fixBy)}.`,
      fixBy,
    };
  });
  if (result.ok) refresh(org);
  return result;
}

/**
 * Suspend now (super_admin, step-up). `input` = `{ category: "illegal" | "legal_demand" |
 * "dmca", note (staff-only, required), message? (added to the owner's CDS note) }`.
 */
export async function suspendNowAction(
  orgId: unknown,
  input: unknown,
): Promise<ActionResult<SuspensionActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const category = own(input, "category");
  if (!(SUSPEND_CATEGORIES as readonly unknown[]).includes(category)) {
    return bad("Pick a reason.", "category");
  }
  const note = textOf(own(input, "note"));
  if (note === null) return bad(TOO_LONG, "note");
  if (note === "") {
    return bad("Add a staff note: why the site goes offline.", "note");
  }
  const message = textOf(own(input, "message"));
  if (message === null) return bad(TOO_LONG, "message");

  const result = await runStaffAction(
    "suspend_now",
    { stepUp: true },
    async (ctx) => {
      await staffSuspendNow(
        ctx,
        {
          orgId: org,
          category: category as string,
          note,
          ...(message ? { message } : {}),
        },
        { invalidator: nextInvalidator },
      );
      const business = await businessOf(ctx, org);
      return { message: `${business} is offline. The owner was told.` };
    },
  );
  if (result.ok) refresh(org);
  return result;
}

/** Mark an open notice fixed (both roles): the notice ends and the owner is told. */
export async function markFixedAction(
  orgId: unknown,
): Promise<ActionResult<SuspensionActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const result = await runStaffAction("suspend_notice", {}, async (ctx) => {
    await staffMarkFixed(ctx, org);
    const business = await businessOf(ctx, org);
    return { message: `Notice closed for ${business}. The owner was told.` };
  });
  if (result.ok) refresh(org);
  return result;
}

/** Lift a suspension (super_admin, step-up): back online at once. */
export async function liftSuspensionAction(
  orgId: unknown,
): Promise<ActionResult<SuspensionActionResult>> {
  const org = orgOf(orgId);
  if (!org) return SITE_NOT_FOUND;
  const result = await runStaffAction(
    "suspend_lift",
    { stepUp: true },
    async (ctx) => {
      await staffLiftSuspension(ctx, org, { invalidator: nextInvalidator });
      const business = await businessOf(ctx, org);
      return { message: `${business} is back online. The owner was told.` };
    },
  );
  if (result.ok) refresh(org);
  return result;
}
