"use server";
// Canned reply actions (13-41 choice 5; STAFF-09, D96, D119; T-13-15-01). Public POST
// endpoints: every argument is untrusted. Thin callers of the 13-15 @cds/db functions:
//   saveCannedAction(input)    -> staffSaveCanned    (audit canned.saved)
//   archiveCannedAction(id)    -> staffArchiveCanned (audit canned.archived; Undo toast 8 s)
//   restoreCannedAction(id)    -> staffRestoreCanned (audit canned.restored)
// `canned_replies` feature, both roles, no step-up. There is no delete (D96: archive only).
// Lengths (80 / 5,000) and unknown placeholders (PLACEHOLDER-UNKNOWN) are refused by the db
// layer; the action pre-checks types and gross sizes only. Errors are logged by class name.
import {
  staffArchiveCanned,
  staffRestoreCanned,
  staffSaveCanned,
  type StaffCannedReply,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const FEATURE = "canned_replies";
const ID_RE = /^[a-z0-9]{15}$/;
/** Far above the chokepoint caps (80 / 5,000); refuse junk payloads before they get there. */
const MAX_TITLE = 400;
const MAX_BODY = 10_000;

const NOT_FOUND: Failure = {
  ok: false,
  code: "not_found",
  message: "That canned reply wasn't found.",
};

export type CannedActionResult = {
  message: string;
  reply: StaffCannedReply;
};

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

function refresh(): void {
  try {
    revalidatePath("/staff/tickets");
  } catch (err) {
    console.error("[staff canned] revalidate failed", errorName(err));
  }
}

/** Create (no `id`) or edit a canned reply. `input` = `{ id?, title, body }`. */
export async function saveCannedAction(
  input: unknown,
): Promise<ActionResult<CannedActionResult>> {
  const id = own(input, "id");
  if (id !== undefined && (typeof id !== "string" || !ID_RE.test(id))) {
    return NOT_FOUND;
  }
  const title = own(input, "title");
  const body = own(input, "body");
  if (typeof title !== "string" || title.length > MAX_TITLE) {
    return bad("Keep the title to 80 characters.", "title");
  }
  if (typeof body !== "string" || body.length > MAX_BODY) {
    return bad("Keep the reply to 5000 characters.", "body");
  }
  const result = await runStaffAction(FEATURE, {}, async (ctx) => {
    const reply = await staffSaveCanned(ctx, {
      ...(id !== undefined ? { id: id as string } : {}),
      title,
      body,
    });
    return { message: `Saved “${reply.title}”.`, reply };
  });
  if (!result.ok && result.code === "invalid_input" && !result.field) {
    // The db's messages name the title or the reply text.
    const field = /title/i.test(result.message) ? "title" : "body";
    return { ...result, field };
  }
  if (result.ok) refresh();
  return result;
}

/** Archive (hide from the picker); the screen offers Undo → restoreCannedAction. */
export async function archiveCannedAction(
  id: unknown,
): Promise<ActionResult<CannedActionResult>> {
  if (typeof id !== "string" || !ID_RE.test(id)) return NOT_FOUND;
  const result = await runStaffAction(FEATURE, {}, async (ctx) => {
    const reply = await staffArchiveCanned(ctx, id);
    return { message: `Archived “${reply.title}”.`, reply };
  });
  if (result.ok) refresh();
  return result;
}

/** Restore an archived reply (Undo, or Restore reply on the Archived list). */
export async function restoreCannedAction(
  id: unknown,
): Promise<ActionResult<CannedActionResult>> {
  if (typeof id !== "string" || !ID_RE.test(id)) return NOT_FOUND;
  const result = await runStaffAction(FEATURE, {}, async (ctx) => {
    const reply = await staffRestoreCanned(ctx, id);
    return { message: `Restored “${reply.title}”.`, reply };
  });
  if (result.ok) refresh();
  return result;
}
