"use server";
// CDS Support actions (12-19 choice 6; COMM-01, COMM-02, COMM-07; T-12-19-01, T-12-19-02).
// Public POST endpoints: every argument is untrusted. The tenant, role and impersonation come
// only from the session cookie via runAction; no action takes a tenant id. Thread ids are
// shape-checked, then the @cds/db support chokepoint loads them scoped to the session org
// (a foreign or missing thread is NotFound). support:write is deny-listed under impersonation
// in the MATRIX, so staff viewing as the tenant get IMPERSONATING-SUPPORT, never a post.
// Rate limits (60 messages/hour/person) come back as code "rate_limited", which the Composer
// shows as RATE-MESSAGES with the text kept. Nothing here logs bodies, names or file names.
import { ImpersonationDenied, InvalidInput } from "@cds/core";
import type { TenantMessage } from "@cds/core/support";
import {
  listThreadMessages,
  markNotesRead,
  markSupportRead,
  mintSupportFileLink,
  postConversationMessage,
  type ThreadMessagesPage,
} from "@cds/db";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";

const ID = /^[a-z0-9]{15}$/;
const GONE = "This was removed or moved. Reload the page to see the latest.";
/** Upload tokens are opaque strings from /hub/api/support/upload; at most 5 per message. */
const MAX_TOKENS = 5;
const MAX_TOKEN_LEN = 200;
const MAX_BODY = 5000;

const COPY = { impersonation: SUPPORT_UI_COPY.IMPERSONATING_SUPPORT };

/**
 * WR-C06: the support-file route never serves impersonating staff (the session must be the
 * org's own member), so the link is refused here, with the staff path, instead of minting
 * a link that dead-ends on "belongs to another site".
 */
const STAFF_DOWNLOAD_COPY =
  "Viewing as staff, files don't download here. Use npm run support:show -- --ticket <n> --download <file-id>.";

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) throw new InvalidInput(GONE);
  return raw;
}

function bodyOf(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string")
    throw new InvalidInput(SUPPORT_UI_COPY.MSG_REQUIRED);
  // The chokepoint trims and enforces 5,000; refuse a far larger payload before it gets there.
  if (raw.length > MAX_BODY * 2) {
    throw new InvalidInput(SUPPORT_UI_COPY.MSG_REQUIRED);
  }
  return raw;
}

function tokensOf(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TOKENS) {
    throw new InvalidInput(SUPPORT_UI_COPY.FILE_TOO_MANY);
  }
  return raw.map((t) => {
    if (typeof t !== "string" || t.length === 0 || t.length > MAX_TOKEN_LEN) {
      throw new InvalidInput(GONE);
    }
    return t;
  });
}

function dateOf(raw: unknown): Date {
  if (typeof raw !== "string" || raw.length > 40) throw new InvalidInput(GONE);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new InvalidInput(GONE);
  return d;
}

function refreshSupport(): void {
  try {
    revalidatePath("/hub/support");
    revalidatePath("/hub", "layout");
  } catch (err) {
    console.error(
      "[support] revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

export type PostedConversationMessage = {
  threadId: string;
  message: TenantMessage;
};

/** Messages tab composer: post to the org's one CDS conversation (created on first post). */
export async function postConversationMessageAction(
  body: unknown,
  tokens: unknown,
): Promise<ActionResult<PostedConversationMessage>> {
  const res = await runAction(async (s) => {
    const text = bodyOf(body);
    const uploadTokens = tokensOf(tokens);
    const out = await postConversationMessage(s.ctx, {
      body: text,
      uploadTokens,
    });
    // The person just wrote here: everything up to their own message is read.
    await markSupportRead(s.ctx, out.conversation.id).catch((err: unknown) =>
      console.error(
        "[support] mark read after post failed",
        err instanceof Error ? err.name : typeof err,
      ),
    );
    return { threadId: out.conversation.id, message: out.message };
  }, COPY);
  if (res.ok) refreshSupport();
  return res;
}

/**
 * "Show earlier messages": the 50 public messages before `before` (oldest first). `beforeId`
 * is that row's id, so rows saved in the same millisecond are not skipped (IN-C07).
 */
export async function loadEarlierMessagesAction(
  threadId: unknown,
  before: unknown,
  beforeId?: unknown,
): Promise<ActionResult<ThreadMessagesPage>> {
  return runAction(async (s) => {
    const id = idOf(threadId);
    const at = dateOf(before);
    return listThreadMessages(s.ctx, id, {
      before: at,
      ...(typeof beforeId === "string" ? { beforeId } : {}),
    });
  }, COPY);
}

/** Opening the Messages tab marks the conversation read for this person (no-op impersonating). */
export async function markConversationReadAction(
  threadId: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await markSupportRead(s.ctx, idOf(threadId));
    return null;
  }, COPY);
  if (res.ok) refreshSupport();
  return res;
}

/** Opening the Messages tab marks the CDS notes read for this person (no-op impersonating). */
export async function markNotesReadAction(): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await markNotesRead(s.ctx);
    return null;
  }, COPY);
  if (res.ok) refreshSupport();
  return res;
}

/** A 15-minute signed download path for one of the org's support files (minted on click). */
export async function mintSupportFileLinkAction(
  fileId: unknown,
): Promise<ActionResult<string>> {
  return runAction(
    async (s) => {
      if (s.ctx.impersonator) throw new ImpersonationDenied();
      return mintSupportFileLink(s.ctx, idOf(fileId));
    },
    { impersonation: STAFF_DOWNLOAD_COPY },
  );
}
