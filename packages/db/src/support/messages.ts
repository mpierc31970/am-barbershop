// P12 CDS conversation (12-12; COMM-01, COMM-07, COMM-10; D82, D93). Each org has one
// ongoing conversation with CDS (support_threads kind "conversation"), created on first write.
//
// - Members: Owner, Admin and Editor post (support:write, refused under impersonation by the
//   MATRIX deny-list); Viewers read only. 60 messages an hour per person (T-12-12-04).
// - Staff: public messages (owners hear about them: cds.message) or internal notes, which no
//   tenant read or poll ever returns (T-12-12-01).
// - Tenant reads put `visibility = 'public'` in the pb.filter string itself, scoped to the org
//   and thread; the projection drops author_staff and visibility.
// - Read state per person in member_prefs.support_read (today/prefs.ts).
import { authorizeStaff, InvalidInput } from "@cds/core";
import type { TenantMessage } from "@cds/core/support";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import type { EmailTransport } from "../email/transport";
import { beginSupportAction } from "../rate-limit";
import { assertId, requirePermission } from "../repository";
import type { ObjectStore } from "../storage";
import { recordSupportRead } from "../today/prefs";
import { notifySupport, type SupportNotifyDeps } from "./notify";
import {
  MESSAGES,
  assertMemberWriter,
  cleanBody,
  ensureConversation,
  errName,
  filesByMessage,
  filesByThread,
  findConversation,
  loadThreadScoped,
  memberDisplayName,
  postWithStaffFiles,
  postWithUploads,
  staffFirstName,
  toTenantMessage,
  uploadTokens,
  type StaffFile,
} from "./shared";

/** Page size cap for a thread read. */
export const THREAD_MESSAGES_MAX = 50;
/** Where a conversation bell row and email point. */
export const CONVERSATION_HREF = "/hub/support?tab=messages";

export type SupportClock = { now(): Date };
const SYSTEM_CLOCK: SupportClock = { now: () => new Date() };

export type ConversationView = {
  id: string;
  /** ISO time of the last public message, "" when none. */
  lastActivityAt: string;
};

export type ThreadMessagesPage = {
  messages: TenantMessage[];
  /** True when older public messages exist before the first one returned. */
  hasEarlier: boolean;
};

export type ConversationPostDeps = {
  store?: ObjectStore;
  clock?: SupportClock;
};

export type StaffConversationDeps = {
  store?: ObjectStore;
  clock?: SupportClock;
  transport?: EmailTransport;
  push?: SupportNotifyDeps["push"];
  types?: SupportNotifyDeps["types"];
};

/** A staff view of one message (support:show): everything, internal notes included. */
export type StaffThreadMessage = TenantMessage & {
  visibility: "public" | "internal";
  authorStaff: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clockNow(clock?: SupportClock): Date {
  const now = (clock ?? SYSTEM_CLOCK).now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new InvalidInput("clock must return a valid date");
  }
  return now;
}

function cursor(v: unknown, what: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new InvalidInput(`${what} is invalid`);
  return d;
}

/** An optional record-id cursor tie-break; anything else is refused. */
function cursorId(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^[a-z0-9]{15}$/.test(v)) {
    throw new InvalidInput("cursor is invalid");
  }
  return v;
}

function conversationView(row: RecordModel): ConversationView {
  return { id: row.id, lastActivityAt: str(row.last_activity_at) };
}

// ---------------------------------------------------------------------------------------
// Members

/** The org's conversation, or null before anyone has written (support:read; never creates). */
export async function getConversation(
  ctx: OrgContext,
): Promise<ConversationView | null> {
  requirePermission(ctx, "support", "read");
  const row = await withSuperuser((pb) => findConversation(pb, ctx.orgId));
  return row ? conversationView(row) : null;
}

/**
 * A member's message to CDS (support:write; Viewers Forbidden, impersonation refused). Up to 5
 * staged uploads attach to it. Audited `support.message_posted` (never the body). Members do
 * not notify themselves, and CDS reads the conversation by CLI in P12 (no staff alert).
 */
export async function postConversationMessage(
  ctx: OrgContext,
  input: { body?: string; uploadTokens?: readonly string[] },
  deps: ConversationPostDeps = {},
): Promise<{ conversation: ConversationView; message: TenantMessage }> {
  requirePermission(ctx, "support", "write");
  assertMemberWriter(ctx);
  const tokens = uploadTokens(input?.uploadTokens);
  const body = cleanBody(input?.body, tokens.length);
  const now = clockNow(deps.clock);
  beginSupportAction("message", { orgId: ctx.orgId, actorId: ctx.actor });
  return withSuperuser(async (pb) => {
    const thread = await ensureConversation(pb, ctx.orgId);
    const authorName = await memberDisplayName(pb, ctx.actor);
    const posted = await postWithUploads(
      pb,
      ctx,
      {
        orgId: ctx.orgId,
        thread,
        authorKind: "member",
        authorUser: ctx.actor,
        authorName,
        body,
        visibility: "public",
      },
      tokens,
      (batch, messageId, files) => {
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action: "support.message_posted",
            organization: ctx.orgId,
            targetCollection: MESSAGES,
            targetId: messageId,
            meta: { thread: thread.id, kind: "conversation", files },
          }),
        );
      },
      now,
      { store: deps.store },
    );
    const row = await pb.collection(MESSAGES).getOne(posted.id);
    return {
      conversation: {
        id: thread.id,
        lastActivityAt: now.toISOString(),
      },
      message: toTenantMessage(row, posted.attachments),
    };
  });
}

/**
 * Public messages of one thread of this org (support:read). Newest page by default (returned
 * oldest first); `before` pages back, `since` returns only messages newer than the cursor (the
 * poll). Internal notes are excluded in the query (T-12-12-01).
 */
export async function listThreadMessages(
  ctx: OrgContext,
  threadId: string,
  opts: {
    since?: string | Date;
    before?: string | Date;
    /** IN-C07 / 12-REVIEW IN-A02: the id of the row `before` came from (same-ms tie-break). */
    beforeId?: string;
    limit?: number;
  } = {},
): Promise<ThreadMessagesPage> {
  requirePermission(ctx, "support", "read");
  const since = cursor(opts.since, "since");
  const before = cursor(opts.before, "before");
  if (since && before) {
    throw new InvalidInput("use since or before, not both");
  }
  const limit = Math.min(
    THREAD_MESSAGES_MAX,
    Math.max(1, Math.floor(Number(opts.limit ?? THREAD_MESSAGES_MAX)) || 1),
  );
  return withSuperuser(async (pb) => {
    const thread = await loadThreadScoped(pb, ctx.orgId, threadId);
    const params: Record<string, unknown> = {
      t: thread.id,
      org: ctx.orgId,
    };
    let filter =
      "thread = {:t} && organization = {:org} && visibility = 'public'";
    if (since) {
      filter += " && created > {:since}";
      params.since = since;
    }
    if (before) {
      const beforeId = cursorId(opts.beforeId);
      if (beforeId) {
        // (created, id) cursor: rows saved in the same millisecond are not skipped.
        filter +=
          " && (created < {:before} || (created = {:before} && id < {:beforeId}))";
        params.beforeId = beforeId;
      } else {
        filter += " && created < {:before}";
      }
      params.before = before;
    }
    let rows: RecordModel[];
    let hasEarlier = false;
    if (since) {
      const res = await pb.collection(MESSAGES).getList(1, limit, {
        filter: pb.filter(filter, params),
        sort: "created,id",
        skipTotal: true,
      });
      rows = res.items;
    } else {
      const res = await pb.collection(MESSAGES).getList(1, limit + 1, {
        filter: pb.filter(filter, params),
        sort: "-created,-id",
        skipTotal: true,
      });
      hasEarlier = res.items.length > limit;
      rows = res.items.slice(0, limit).reverse();
    }
    const files = await filesByMessage(
      pb,
      ctx.orgId,
      rows.map((r) => r.id),
    );
    return {
      messages: rows.map((r) => toTenantMessage(r, files.get(r.id) ?? [])),
      hasEarlier,
    };
  });
}

/**
 * Marks a thread of this org read for the caller (support:read). A no-op for an impersonator,
 * a job or a context without a person. Another org's thread id throws NotFound.
 */
export async function markSupportRead(
  ctx: OrgContext,
  threadId: string,
  now: Date = new Date(),
): Promise<void> {
  requirePermission(ctx, "support", "read");
  if (ctx.impersonator || ctx.systemJob || !ctx.actor) return;
  const thread = await withSuperuser((pb) =>
    loadThreadScoped(pb, ctx.orgId, threadId),
  );
  await recordSupportRead(ctx, thread.id, now);
}

// ---------------------------------------------------------------------------------------
// Staff

async function orgName(
  pb: Parameters<Parameters<typeof withSuperuser>[0]>[0],
  orgId: string,
): Promise<string> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "id,name" });
  return str(org.name) || "your site";
}

/**
 * A staff message on an org's conversation (`cds_post`): public, or an internal note the
 * tenant never sees. Author name is the staff member's first name; files are staff files
 * (`scan: "staff"`). Audited with the org. A public message raises `cds.message` for the
 * org's members (bell + no-reply email, 300-character excerpt); an internal note notifies
 * nobody. `raised` is the number of bell rows.
 */
export async function staffPostConversationMessage(
  ctx: PlatformContext,
  input: {
    orgId: string;
    body?: string;
    internal?: boolean;
    files?: readonly StaffFile[];
  },
  deps: StaffConversationDeps = {},
): Promise<{ messageId: string; threadId: string; raised: number }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "cds_post");
  assertId(input?.orgId);
  const files = Array.isArray(input.files) ? input.files : [];
  const body = cleanBody(input.body, files.length);
  const internal = input.internal === true;
  const now = clockNow(deps.clock);
  const orgId = input.orgId;

  const posted = await withSuperuser(async (pb) => {
    const business = await orgName(pb, orgId);
    const thread = await ensureConversation(pb, orgId);
    const authorName = await staffFirstName(pb, ctx.actor);
    const res = await postWithStaffFiles(
      pb,
      ctx,
      {
        orgId,
        thread,
        authorKind: "staff",
        authorStaff: ctx.actor,
        authorName,
        body,
        visibility: internal ? "internal" : "public",
      },
      files,
      (batch, messageId, n) => {
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action: "support.message_posted",
            organization: orgId,
            targetCollection: MESSAGES,
            targetId: messageId,
            meta: {
              thread: thread.id,
              kind: "conversation",
              internal,
              files: n,
            },
          }),
        );
      },
      now,
      { store: deps.store },
    );
    return { ...res, threadId: thread.id, business, authorName };
  });

  let raised = 0;
  if (!internal) {
    try {
      const r = await notifySupport(
        {
          orgId,
          as: ctx,
          type: "cds.message",
          title: "New message from Support",
          href: CONVERSATION_HREF,
          excerpt: body.slice(0, 300),
          authorFirstName: posted.authorName,
          businessName: posted.business,
        },
        { now, transport: deps.transport, push: deps.push, types: deps.types },
      );
      raised = r.raised;
    } catch (err) {
      // The message is saved; a failed alert never undoes it.
      console.error(`[support] cds.message alert failed ${errName(err)}`);
    }
  }
  return { messageId: posted.id, threadId: posted.threadId, raised };
}

/**
 * Every message of one org thread, internal notes included (staff `support_read`; the
 * support:show CLI). Oldest first, up to 500.
 */
export async function staffListThreadMessages(
  ctx: PlatformContext,
  input: { orgId: string; threadId: string },
): Promise<StaffThreadMessage[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_read");
  assertId(input?.orgId);
  return withSuperuser(async (pb) => {
    const thread = await loadThreadScoped(pb, input.orgId, input.threadId);
    const res = await pb.collection(MESSAGES).getList(1, 500, {
      filter: pb.filter("thread = {:t} && organization = {:org}", {
        t: thread.id,
        org: input.orgId,
      }),
      sort: "created,id",
      skipTotal: true,
    });
    const files = await filesByThread(pb, input.orgId, thread.id);
    return res.items.map((r) => ({
      ...toTenantMessage(r, files.get(r.id) ?? []),
      visibility: r.visibility === "internal" ? "internal" : "public",
      authorStaff: str(r.author_staff),
    }));
  });
}
