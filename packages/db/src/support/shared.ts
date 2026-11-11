// P12 support internal helpers (12-12; COMM-01, COMM-07). NOT re-exported by the support
// barrel: tickets (12-15), notes (12-16) and staff tickets (12-18) import these directly and
// never edit this file.
//
// - loadThreadScoped: the org filter is in the query, so another org's thread id throws the
//   same NotFound as a missing one (T-12-12-02).
// - appendMessage: adds one message create to a caller's batch and bumps the thread's
//   activity stamps. Internal notes never touch the thread (last_activity_at is tenant-visible,
//   so an internal note must not move it either).
// - toTenantMessage: allowlist projection. Never author_staff, never visibility (T-12-12-01).
// - postWithUploads / postWithStaffFiles: the "message row first, then files, then one batch"
//   dance (support_files rows relate to an existing message), undone on failure.
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
} from "@cds/core";
import type {
  TenantAttachment,
  TenantMessage,
  TicketStatus,
} from "@cds/core/support";
import type PocketBase from "pocketbase";
import {
  ClientResponseError,
  type BatchService,
  type RecordModel,
} from "pocketbase";
import type { OrgContext, PlatformContext } from "../context";
import { isUniqueViolation } from "../payments/staff-alert";
import { assertId, newRecordId } from "../repository";
import { getObjectStore, type ObjectStore } from "../storage";
import {
  SUPPORT_FILES_PER_MESSAGE,
  attachStagedUploads,
  staffStoreSupportFile,
} from "./files";

export const THREADS = "support_threads";
export const MESSAGES = "support_messages";
export const FILES = "support_files";

/**
 * Orgs a broadcast notice may reach (12-REVIEW WR-A01): every org except a closed one (the
 * retention job's `status = 'disabled' && closed_reason != ''`, inverted). A closed or declined
 * site waiting for deletion never gets window or Built notices; a lapsed site still does.
 */
export const OPEN_ORG_FILTER = "(status != 'disabled' || closed_reason = '')";

/** The same rule for a loaded organizations row. */
export function isOpenOrg(row: Record<string, unknown>): boolean {
  return !(row.status === "disabled" && String(row.closed_reason ?? "") !== "");
}

/** Message body cap after trimming (P12-P5). */
export const MESSAGE_BODY_MAX = 5000;
/** Display name cap (support_messages.author_name max 60). */
const AUTHOR_NAME_MAX = 60;

export type AuthorKind = "member" | "staff" | "system";
export type Visibility = "public" | "internal";

/** A system line: the event kind, the move and the label the thread shows. */
export type MessageEvent = {
  kind: string;
  from?: TicketStatus;
  to?: TicketStatus;
  label: string;
};

export type AppendInput = {
  /** Optional: callers that must know the id first (attachments) pass one. */
  id?: string;
  orgId: string;
  thread: RecordModel;
  authorKind: AuthorKind;
  authorUser?: string;
  authorStaff?: string;
  authorName: string;
  body: string;
  visibility: Visibility;
  event?: MessageEvent | null;
  attachments?: readonly TenantAttachment[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Trims and checks a message body: at most 5,000 characters; empty only when at least one
 * attachment comes with it.
 */
export function cleanBody(body: unknown, attachmentCount: number): string {
  if (body !== undefined && body !== null && typeof body !== "string") {
    throw new InvalidInput("message must be text");
  }
  const text = (body ?? "").trim();
  if (text.length > MESSAGE_BODY_MAX) {
    throw new InvalidInput(
      `message must be at most ${MESSAGE_BODY_MAX} characters`,
    );
  }
  if (text.length === 0 && attachmentCount < 1) {
    throw new InvalidInput("write a message or attach a file");
  }
  return text;
}

/** A display name for author_name (≤ 60 characters, never empty). */
export function cleanAuthorName(name: unknown, fallback: string): string {
  const n = str(name).replace(/\s+/g, " ").trim();
  return (n || fallback).slice(0, AUTHOR_NAME_MAX);
}

/** First word of a person's name (staff show as their first name), else `fallback`. */
export function firstNameOf(name: unknown, fallback: string): string {
  const first = str(name).trim().split(/\s+/)[0] ?? "";
  return cleanAuthorName(first, fallback);
}

/** A thread of this org, or NotFound (missing and foreign look the same). */
export async function loadThreadScoped(
  pb: PocketBase,
  orgId: string,
  threadId: unknown,
): Promise<RecordModel> {
  assertId(threadId);
  assertId(orgId);
  try {
    return await pb.collection(THREADS).getFirstListItem(
      pb.filter("id = {:t} && organization = {:org}", {
        t: threadId,
        org: orgId,
      }),
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound();
    }
    throw err;
  }
}

/** The org's conversation thread, or null (never creates). */
export async function findConversation(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel | null> {
  assertId(orgId);
  const res = await pb.collection(THREADS).getList(1, 1, {
    filter: pb.filter("organization = {:org} && kind = 'conversation'", {
      org: orgId,
    }),
    skipTotal: true,
  });
  return res.items[0] ?? null;
}

/**
 * The org's conversation, created on first write. The partial unique index (one conversation
 * per org) decides a race: the loser re-reads the winner's row (RESEARCH Pitfall 13).
 */
export async function ensureConversation(
  pb: PocketBase,
  orgId: string,
): Promise<RecordModel> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await findConversation(pb, orgId);
    if (found) return found;
    try {
      return await pb.collection(THREADS).create({
        id: newRecordId(),
        organization: orgId,
        kind: "conversation",
        number: 0,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  const found = await findConversation(pb, orgId);
  if (found) return found;
  throw new InvalidInput("the conversation is being created; try again");
}

/**
 * Adds the message create to `batch` and, for public rows, the thread's activity stamps
 * (`last_cds_activity_at` too for staff and system rows). Returns the message id.
 */
export function appendMessage(
  pb: PocketBase,
  batch: BatchService,
  input: AppendInput,
  now: Date,
): string {
  void pb;
  if (input.thread.organization !== input.orgId) throw new NotFound();
  const id = input.id ?? newRecordId();
  batch.collection(MESSAGES).create({
    id,
    organization: input.orgId,
    thread: input.thread.id,
    author_kind: input.authorKind,
    author_user: input.authorUser ?? "",
    author_staff: input.authorStaff ?? "",
    author_name: cleanAuthorName(input.authorName, "CDS"),
    body: input.body,
    visibility: input.visibility,
    event: input.event ?? null,
    attachments: input.attachments ?? [],
  });
  touchThread(batch, input, now);
  return id;
}

/** The thread stamps for a public message (internal notes leave the thread alone). */
export function touchThread(
  batch: BatchService,
  input: Pick<AppendInput, "thread" | "authorKind" | "visibility">,
  now: Date,
): void {
  if (input.visibility !== "public") return;
  const at = now.toISOString();
  batch.collection(THREADS).update(input.thread.id, {
    last_activity_at: at,
    ...(input.authorKind === "member" ? {} : { last_cds_activity_at: at }),
  });
}

function attachmentsOf(v: unknown): TenantAttachment[] {
  if (!Array.isArray(v)) return [];
  const out: TenantAttachment[] = [];
  for (const a of v) {
    if (typeof a !== "object" || a === null) continue;
    const r = a as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    out.push({
      id: r.id,
      name: str(r.name),
      size: typeof r.size === "number" ? r.size : 0,
      mime: str(r.mime),
      scan: r.scan === "clean" || r.scan === "staff" ? r.scan : "pending",
    });
  }
  return out;
}

function eventLabel(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const label = (v as Record<string, unknown>).label;
  return typeof label === "string" && label ? label : null;
}

/**
 * Allowlist projection for the hub. `files` (the message's support_files rows, already
 * projected) wins over the row's stored summary so scan state is current.
 */
export function toTenantMessage(
  row: RecordModel,
  files?: readonly TenantAttachment[],
): TenantMessage {
  const kind: TenantMessage["authorKind"] =
    row.author_kind === "staff" || row.author_kind === "system"
      ? row.author_kind
      : "member";
  return {
    id: row.id,
    authorKind: kind,
    authorName: str(row.author_name) || (kind === "member" ? "" : "CDS"),
    body: str(row.body),
    event: eventLabel(row.event),
    attachments: files ? [...files] : attachmentsOf(row.attachments),
    created: str(row.created),
  };
}

/** Projected support_files rows per message id, oldest first. */
export async function filesByMessage(
  pb: PocketBase,
  orgId: string,
  messageIds: readonly string[],
): Promise<Map<string, TenantAttachment[]>> {
  const out = new Map<string, TenantAttachment[]>();
  if (messageIds.length === 0) return out;
  const params: Record<string, string> = { org: orgId };
  const ors = messageIds.map((id, i) => {
    params[`m${i}`] = id;
    return `message = {:m${i}}`;
  });
  // Placeholders only: every id is bound through params, never interpolated.
  const expr = "organization = {:org} && (" + ors.join(" || ") + ")";
  const rows = await pb.collection(FILES).getFullList({
    filter: pb.filter(expr, params),
    sort: "created,id",
  });
  for (const r of rows) groupFile(out, r);
  return out;
}

/** Projected support_files rows of one thread, grouped by message id (staff reads). */
export async function filesByThread(
  pb: PocketBase,
  orgId: string,
  threadId: string,
): Promise<Map<string, TenantAttachment[]>> {
  const out = new Map<string, TenantAttachment[]>();
  const rows = await pb.collection(FILES).getFullList({
    filter: pb.filter("organization = {:org} && thread = {:t}", {
      org: orgId,
      t: threadId,
    }),
    sort: "created,id",
  });
  for (const r of rows) groupFile(out, r);
  return out;
}

function groupFile(out: Map<string, TenantAttachment[]>, r: RecordModel) {
  const m = str(r.message);
  const list = out.get(m) ?? [];
  list.push({
    id: r.id,
    name: str(r.name),
    size: typeof r.size === "number" ? r.size : 0,
    mime: str(r.mime),
    scan: r.scan === "clean" || r.scan === "staff" ? r.scan : "pending",
  });
  out.set(m, list);
}

/** A member writing in Support: a real signed-in person, never impersonated, never a job. */
export function assertMemberWriter(ctx: OrgContext): void {
  if (ctx.impersonator) {
    throw new ImpersonationDenied("staff reply through the staff tools");
  }
  if (ctx.systemJob || !ctx.actor) {
    throw new Forbidden("support messages come from a signed-in person");
  }
}

/** The member's display name (users.name), else "Team member". */
export async function memberDisplayName(
  pb: PocketBase,
  userId: string,
): Promise<string> {
  const row = await pb
    .collection("users")
    .getOne(userId, { fields: "id,name" })
    .catch(() => null);
  return cleanAuthorName(row?.name, "Team member");
}

/** The staff member's first name (users.name), else "CDS". */
export async function staffFirstName(
  pb: PocketBase,
  userId: string,
): Promise<string> {
  const row = await pb
    .collection("users")
    .getOne(userId, { fields: "id,name" })
    .catch(() => null);
  return firstNameOf(row?.name, "CDS");
}

export function uploadTokens(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((t) => typeof t !== "string")) {
    throw new InvalidInput("invalid upload");
  }
  if (v.length > SUPPORT_FILES_PER_MESSAGE) {
    throw new InvalidInput("at most 5 files per message");
  }
  return v as string[];
}

async function deleteMessage(pb: PocketBase, id: string): Promise<void> {
  await pb
    .collection(MESSAGES)
    .delete(id)
    .catch(() => undefined);
}

/**
 * A member message. Without files: one batch (message, thread stamps, `extra` ops such as the
 * audit row and a ticket move). With files: the message row is created first (support_files
 * relate to it), the staged uploads attach, then one batch writes the attachment summary,
 * thread stamps and `extra`. Any failure deletes the message (attachStagedUploads removes its
 * own objects and rows).
 */
export async function postWithUploads(
  pb: PocketBase,
  ctx: OrgContext,
  input: Omit<AppendInput, "id" | "attachments">,
  tokens: readonly string[],
  extra: (batch: BatchService, messageId: string, files: number) => void,
  now: Date,
  deps: { store?: ObjectStore } = {},
): Promise<{ id: string; attachments: TenantAttachment[] }> {
  const id = newRecordId();
  if (tokens.length === 0) {
    const batch = pb.createBatch();
    appendMessage(pb, batch, { ...input, id }, now);
    extra(batch, id, 0);
    await batch.send();
    return { id, attachments: [] };
  }
  // Only the create here: thread stamps go with the final batch.
  await pb.collection(MESSAGES).create({
    id,
    organization: input.orgId,
    thread: input.thread.id,
    author_kind: input.authorKind,
    author_user: input.authorUser ?? "",
    author_staff: input.authorStaff ?? "",
    author_name: cleanAuthorName(input.authorName, "CDS"),
    body: input.body,
    // 12-REVIEW WR-A06: hidden from members until the files are attached (final batch).
    visibility: "internal",
    event: input.event ?? null,
    attachments: [],
  });
  let attachments: TenantAttachment[];
  try {
    attachments = await attachStagedUploads(
      pb,
      ctx,
      { threadId: input.thread.id, messageId: id, tokens },
      deps,
    );
    const batch = pb.createBatch();
    batch
      .collection(MESSAGES)
      .update(id, { attachments, visibility: input.visibility });
    touchThread(batch, input, now);
    extra(batch, id, attachments.length);
    await batch.send();
  } catch (err) {
    await removeMessageFiles(pb, id, deps.store);
    await deleteMessage(pb, id);
    throw err;
  }
  return { id, attachments };
}

/** Deletes a message's support_files rows and their objects (failure cleanup). */
async function removeMessageFiles(
  pb: PocketBase,
  messageId: string,
  store?: ObjectStore,
): Promise<void> {
  const rows = await pb
    .collection(FILES)
    .getFullList({ filter: pb.filter("message = {:m}", { m: messageId }) })
    .catch(() => [] as RecordModel[]);
  const s = store ?? getObjectStore();
  await Promise.all(
    rows.map(async (r) => {
      if (str(r.object_key))
        await s.delete(str(r.object_key)).catch(() => undefined);
      await pb
        .collection(FILES)
        .delete(r.id)
        .catch(() => undefined);
    }),
  );
}

export type StaffFile = { name: string; bytes: Uint8Array };

/**
 * A staff message (public or internal) with optional files: same shape as postWithUploads,
 * files stored by staffStoreSupportFile (`scan: "staff"`, P12-P3).
 */
export async function postWithStaffFiles(
  pb: PocketBase,
  ctx: PlatformContext,
  input: Omit<AppendInput, "id" | "attachments">,
  files: readonly StaffFile[],
  extra: (batch: BatchService, messageId: string, files: number) => void,
  now: Date,
  deps: { store?: ObjectStore } = {},
): Promise<{ id: string; attachments: TenantAttachment[] }> {
  const id = newRecordId();
  if (files.length === 0) {
    const batch = pb.createBatch();
    appendMessage(pb, batch, { ...input, id }, now);
    extra(batch, id, 0);
    await batch.send();
    return { id, attachments: [] };
  }
  if (files.length > SUPPORT_FILES_PER_MESSAGE) {
    throw new InvalidInput("at most 5 files per message");
  }
  await pb.collection(MESSAGES).create({
    id,
    organization: input.orgId,
    thread: input.thread.id,
    author_kind: input.authorKind,
    author_user: input.authorUser ?? "",
    author_staff: input.authorStaff ?? "",
    author_name: cleanAuthorName(input.authorName, "CDS"),
    body: input.body,
    // 12-REVIEW WR-A06: hidden from members until the files are attached (final batch).
    visibility: "internal",
    event: input.event ?? null,
    attachments: [],
  });
  const attachments: TenantAttachment[] = [];
  try {
    for (const f of files) {
      attachments.push(
        await staffStoreSupportFile(
          ctx,
          {
            orgId: input.orgId,
            threadId: input.thread.id,
            messageId: id,
            name: f?.name,
            bytes: f?.bytes,
            visibility: input.visibility,
          },
          deps,
        ),
      );
    }
    const batch = pb.createBatch();
    batch
      .collection(MESSAGES)
      .update(id, { attachments, visibility: input.visibility });
    touchThread(batch, input, now);
    extra(batch, id, attachments.length);
    await batch.send();
  } catch (err) {
    await removeMessageFiles(pb, id, deps.store);
    await deleteMessage(pb, id);
    throw err;
  }
  return { id, attachments };
}
