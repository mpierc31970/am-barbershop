"use server";
// Inbox actions (07-19; CONT-25, D231, D311, D-UI-P7-20; CONTEXT resolution g; T-07-19-08,
// T-07-19-09). Public POST endpoints: every argument is untrusted. The tenant, role and
// impersonation come only from the session cookie via runAction; no action takes a tenant id
// and unknown keys are dropped. Ids are shape-checked before they reach the @cds/db forms
// chokepoint, which scopes every id to the session tenant and enforces content read (list,
// open, mark read/unread) and content write (Not spam, delete). Read state changes only from a
// user's open (choice 7), never during a server render. Nothing here logs answers, emails or
// names.
import { InvalidInput } from "@cds/core";
import {
  deleteSubmission,
  exportSubmissionsCsv,
  getSubmission,
  listSubmissions,
  markNotSpam,
  setSubmissionRead,
  type SubmissionDetail,
  type SubmissionPage,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

const ID = /^[a-z0-9]{1,32}$/i;
const GONE = "This was removed or moved. Reload the page to see the latest.";
const PER_PAGE = 50;
const MAX_Q = 100;
const MAX_PAGE = 1000;

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) throw new InvalidInput(GONE);
  return raw;
}

function own(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function refreshInbox(): void {
  try {
    revalidatePath("/hub/inbox");
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error("[inbox] revalidate failed", err);
  }
}

export type MessageDetail = SubmissionDetail & { read: boolean };

/** One page of messages; allow-listed keys only, perPage fixed at 50. */
export async function listMessagesAction(
  raw: unknown,
): Promise<ActionResult<SubmissionPage>> {
  const view = own(raw, "view") === "filtered" ? "filtered" : "messages";
  const form = own(raw, "form");
  const q = own(raw, "q");
  const page = own(raw, "page");
  return runAction((s) =>
    listSubmissions(s.ctx, {
      view,
      ...(typeof form === "string" && ID.test(form) ? { form } : {}),
      ...(typeof q === "string" && q.trim() !== ""
        ? { q: q.trim().slice(0, MAX_Q) }
        : {}),
      page:
        typeof page === "number" && Number.isInteger(page) && page >= 1
          ? Math.min(page, MAX_PAGE)
          : 1,
      perPage: PER_PAGE,
    }),
  );
}

/** Open a message: read it, then mark it read (choice 7). */
export async function openMessageAction(
  id: unknown,
): Promise<ActionResult<MessageDetail>> {
  const res = await runAction(async (s) => {
    const sid = idOf(id);
    const detail = await getSubmission(s.ctx, sid);
    await setSubmissionRead(s.ctx, sid, true);
    return { ...detail, read: true };
  });
  if (res.ok) refreshInbox();
  return res;
}

export async function setMessageReadAction(
  id: unknown,
  read: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await setSubmissionRead(s.ctx, idOf(id), read === true);
    return null;
  });
  if (res.ok) refreshInbox();
  return res;
}

export async function markNotSpamAction(
  id: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await markNotSpam(s.ctx, idOf(id));
    return null;
  });
  if (res.ok) refreshInbox();
  return res;
}

export async function deleteMessageAction(
  id: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await deleteSubmission(s.ctx, idOf(id));
    return null;
  });
  if (res.ok) refreshInbox();
  return res;
}

/** One form's messages as CSV (D-UI-P7-20: per form only). */
export async function exportMessagesAction(
  formId: unknown,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  return runAction((s) => exportSubmissionsCsv(s.ctx, idOf(formId)));
}
