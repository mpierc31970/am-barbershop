"use server";
// Ticket actions (12-20 choices 3, 5; COMM-06, COMM-07, COMM-08, COMM-09, SUPPORT-02;
// T-12-20-01, T-12-20-02, T-12-20-04). Public POST endpoints: every argument is untrusted.
// The tenant, role and impersonation come only from the session cookie via runAction; no
// action takes an org id. Ticket numbers go through parseTicketNumber (junk is NotFound, the
// same as another site's number). The silent context is built here: the browser summary comes
// from the request's own User-Agent header (never the client body) and `from` is only passed
// on; fileTicket keeps it only when it is a same-origin /hub path. support:write is deny-listed
// under impersonation, so staff viewing as the tenant get IMPERSONATING-SUPPORT, never a post.
// Rate limits come back as code "rate_limited" (the form shows RATE-TICKETS, the composer
// RATE-MESSAGES). Nothing here logs bodies, names or file names.
// Downloads use mintSupportFileLinkAction from ./support (12-19), shared by every screen.
import { InvalidInput, NotFound } from "@cds/core";
import {
  parseTicketNumber,
  type TicketStatus,
  type TicketType,
} from "@cds/core/support";
import {
  fileTicket,
  getTicketByNumber,
  listThreadMessages,
  markSupportRead,
  markTicketSolved,
  replyToTicket,
  undoMarkTicketSolved,
  type ThreadMessagesPage,
} from "@cds/db";
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { runAction, type ActionResult } from "../../lib/action";
import type { HubSession } from "../../lib/session";

const ID = /^[a-z0-9]{15}$/;
const GONE = "This was removed or moved. Reload the page to see the latest.";
const MAX_TOKENS = 5;
const MAX_TOKEN_LEN = 200;
/** Chokepoint caps are 80 / 5,000; refuse far larger payloads before they get there. */
const MAX_SUBJECT = 400;
const MAX_BODY = 10_000;
const MAX_TARGET = 200;
const MAX_FROM = 2048;
const MAX_UA = 512;
const TYPES: readonly TicketType[] = [
  "problem",
  "change",
  "question",
  "billing",
];

const COPY = { impersonation: SUPPORT_UI_COPY.IMPERSONATING_SUPPORT };

function own(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null) return undefined;
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function numberOf(raw: unknown): number {
  try {
    return parseTicketNumber(raw);
  } catch {
    throw new NotFound(GONE);
  }
}

function idOf(raw: unknown): string {
  if (typeof raw !== "string" || !ID.test(raw)) throw new InvalidInput(GONE);
  return raw;
}

function textOf(raw: unknown, max: number, empty: string): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") throw new InvalidInput(empty);
  if (raw.length > max) throw new InvalidInput(empty);
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

function typeOf(raw: unknown): TicketType {
  if (typeof raw !== "string" || !(TYPES as readonly string[]).includes(raw)) {
    throw new InvalidInput(SUPPORT_UI_COPY.TYPE_REQUIRED);
  }
  return raw as TicketType;
}

function optional(raw: unknown, max: number): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > max) {
    return null;
  }
  return raw;
}

/** The request's own User-Agent (server-side; T-12-20-02). */
async function requestUserAgent(): Promise<string | null> {
  try {
    const ua = (await headers()).get("user-agent") ?? "";
    return ua ? ua.slice(0, MAX_UA) : null;
  } catch {
    return null;
  }
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

export type FiledTicket = { number: number; type: TicketType };

/** Get help form: file one ticket for the session's org. */
export async function fileTicketAction(
  input: unknown,
): Promise<ActionResult<FiledTicket>> {
  const res = await runAction(async (s) => {
    const type = typeOf(own(input, "type"));
    const subject = textOf(
      own(input, "subject"),
      MAX_SUBJECT,
      SUPPORT_UI_COPY.SUBJECT_REQUIRED,
    );
    const body = textOf(
      own(input, "body"),
      MAX_BODY,
      SUPPORT_UI_COPY.BODY_REQUIRED,
    );
    const target = optional(own(input, "target"), MAX_TARGET);
    const fromUrl = optional(own(input, "from"), MAX_FROM);
    const uploadTokens = tokensOf(own(input, "uploadTokens"));
    const userAgent = await requestUserAgent();
    const out = await fileTicket(s.ctx, {
      type,
      target: target ?? undefined,
      subject,
      body,
      uploadTokens,
      fromUrl,
      userAgent,
      addonNames: Object.fromEntries(
        ADDON_REGISTRY.list().map((m) => [m.slug, m.name]),
      ),
    });
    return { number: out.number, type };
  }, COPY);
  if (res.ok) refreshSupport();
  return res;
}

/**
 * The ticket after a change. Both fields are null when the write landed but the refresh
 * read failed (WR-C02): the action still reports success, and the client falls back to a
 * router refresh instead of showing an error that invites a duplicate reply or solve.
 */
export type TicketUpdate =
  | { status: TicketStatus; page: ThreadMessagesPage }
  | { status: null; page: null };

/** The ticket's status and newest 50 public messages after a change (scoped by the session). */
async function latest(
  s: HubSession,
  n: number,
): Promise<{
  status: TicketStatus;
  page: ThreadMessagesPage;
  threadId: string;
}> {
  const ticket = await getTicketByNumber(s.ctx, String(n));
  const page = await listThreadMessages(s.ctx, ticket.id);
  return { status: ticket.status, page, threadId: ticket.id };
}

/** `latest` after a write that already landed: a failed read is logged, never an error. */
async function latestAfterWrite(
  s: HubSession,
  n: number,
): Promise<{
  status: TicketStatus;
  page: ThreadMessagesPage;
  threadId: string;
} | null> {
  return latest(s, n).catch((err: unknown) => {
    console.error(
      "[support] refresh after write failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  });
}

const NO_UPDATE: TicketUpdate = { status: null, page: null };

/** Ticket detail composer: reply (moves Waiting on you / Resolved to In progress). */
export async function replyTicketAction(
  number: unknown,
  body: unknown,
  tokens: unknown,
): Promise<ActionResult<TicketUpdate>> {
  const res = await runAction(async (s) => {
    const n = numberOf(number);
    const text = textOf(body, MAX_BODY, SUPPORT_UI_COPY.MSG_REQUIRED);
    const uploadTokens = tokensOf(tokens);
    await replyToTicket(s.ctx, n, { body: text, uploadTokens });
    // WR-C02: the reply has landed; from here nothing may turn it into a failure.
    const fresh = await latestAfterWrite(s, n);
    if (!fresh) return NO_UPDATE;
    // The person just wrote here: everything up to their own reply is read.
    await markSupportRead(s.ctx, fresh.threadId).catch((err: unknown) =>
      console.error(
        "[support] mark read after reply failed",
        err instanceof Error ? err.name : typeof err,
      ),
    );
    return { status: fresh.status, page: fresh.page };
  }, COPY);
  if (res.ok) refreshSupport();
  return res;
}

/** "This is solved": Resolved now, with a 30 s undo on the server (8 s toast). */
export async function markSolvedAction(
  number: unknown,
): Promise<ActionResult<TicketUpdate>> {
  const res = await runAction(async (s) => {
    const n = numberOf(number);
    await markTicketSolved(s.ctx, n);
    const fresh = await latestAfterWrite(s, n);
    return fresh ? { status: fresh.status, page: fresh.page } : NO_UPDATE;
  }, COPY);
  if (res.ok) refreshSupport();
  return res;
}

/** Undo on the "Marked as solved." toast: restores the previous status, removes the line. */
export async function undoSolvedAction(
  number: unknown,
): Promise<ActionResult<TicketUpdate>> {
  const res = await runAction(async (s) => {
    const n = numberOf(number);
    await undoMarkTicketSolved(s.ctx, n);
    const fresh = await latestAfterWrite(s, n);
    return fresh ? { status: fresh.status, page: fresh.page } : NO_UPDATE;
  }, COPY);
  if (res.ok) refreshSupport();
  return res;
}

/** Opening a ticket (and new CDS rows arriving) marks its replies read for this person. */
export async function markTicketReadAction(
  threadId: unknown,
): Promise<ActionResult<null>> {
  const res = await runAction(async (s) => {
    await markSupportRead(s.ctx, idOf(threadId));
    return null;
  }, COPY);
  if (res.ok) refreshSupport();
  return res;
}
