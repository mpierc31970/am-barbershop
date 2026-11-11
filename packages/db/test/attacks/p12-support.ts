// P12 support attacks (12-04, TEN-03, invariant 1, COMM-01/04/07): support_threads,
// support_messages, support_files, cds_notes, cds_documents, feature_idea_votes and
// held_drafts. Every collection is writes: custom, so the generic repo is read-only and org
// B's get of org A's row is NotFound. support_messages also has a rowFilter: org A's own
// owner cannot get, list or filter its way to an internal note in its own org.
//
// 12-32 adds the function-level attacks: ticket by number, reply, conversation post, the
// internal note through the tenant read and poll, file and document links, idea votes, held
// drafts of another person, every member write while impersonated, and the incident view.
// Every attack runs as org B (or as org A's Editor / an impersonator) and leaves org A
// unchanged: the suite's "left every org A row unchanged" snapshot covers them all.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImpersonationDenied, InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { expect } from "vitest";
import { mintOrgContext, type OrgContext } from "../../src/context";
import { resetSupportLimitsForTests } from "../../src/rate-limit";
import { tenantRepo } from "../../src/repository";
import { LocalDiskStore } from "../../src/storage/local-disk";
import {
  applyHeldDraft,
  discardHeldDraft,
  fileTicket,
  getTicketByNumber,
  incidentForTicket,
  listHeldDrafts,
  listThreadMessages,
  markSupportRead,
  markTicketSolved,
  mintSupportFileLink,
  openSupportFile,
  postConversationMessage,
  replyToTicket,
  signSupportFileLink,
  stageSupportUpload,
  toggleIdeaVote,
  undoDiscardHeldDraft,
  type HeldApplyDeps,
} from "../../src/support";
import type { TwoOrgs } from "../fixtures";
import { fakeScanner } from "../support-fakes";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

export const P12_SUPPORT_COLLECTIONS = [
  "support_threads",
  "support_messages",
  "support_files",
  "cds_notes",
  "cds_documents",
  "feature_idea_votes",
  "held_drafts",
] as const;

export type P12SupportCollection = (typeof P12_SUPPORT_COLLECTIONS)[number];

type PerOrg<T> = { A: T; B: T };

export type P12SupportSeed = {
  rows: Record<P12SupportCollection, { A: string; B: string }>;
  /** Org A's internal note (visibility internal). */
  internalA: string;
  idea: string;
  /** Each org's seeded ticket number (A 9001, B 9002). */
  numbers: PerOrg<number>;
  /** Each org's conversation thread id. */
  conversations: PerOrg<string>;
  /** Incident titles linked to each org's ticket. */
  incidentTitles: PerOrg<string>;
  /** Org A's Editor (a second person in org A; the held draft belongs to the Owner). */
  editorA: OrgContext;
};

const IP = "10.0.0.9";

async function seedOrgRows(
  pb: PocketBase,
  org: string,
  owner: string,
  idea: string,
  n: number,
): Promise<
  Record<P12SupportCollection, string> & {
    internal: string;
    number: number;
    conversation: string;
    incidentTitle: string;
  }
> {
  const incidentTitle = `Seed incident ${n} ${org}`;
  const incident = await pb.collection("incidents").create({
    seq: 9100 + n,
    title: incidentTitle,
    public_text: `Public text ${n}`,
    status: "open",
    created_by: "stf000000000001",
  });
  const number = 9000 + n;
  const thread = await pb.collection("support_threads").create({
    organization: org,
    kind: "ticket",
    number,
    type: "question",
    subject: `Seed ticket ${n}`,
    status: "open",
    opened_by: owner,
    assignee: "staff-secret",
    priority: "high",
    incident: incident.id,
    last_activity_at: new Date().toISOString(),
  });
  const conversation = await pb.collection("support_threads").create({
    organization: org,
    kind: "conversation",
    number: 0,
    last_activity_at: new Date().toISOString(),
  });
  await pb.collection("support_messages").create({
    organization: org,
    thread: conversation.id,
    author_kind: "member",
    author_user: owner,
    author_name: "Owner",
    body: `Conversation seed ${n}`,
    visibility: "public",
  });
  const message = await pb.collection("support_messages").create({
    organization: org,
    thread: thread.id,
    author_kind: "member",
    author_user: owner,
    author_name: "Owner",
    body: `Public seed ${n}`,
    visibility: "public",
  });
  const internal = await pb.collection("support_messages").create({
    organization: org,
    thread: thread.id,
    author_kind: "staff",
    author_staff: "stf000000000001",
    author_name: "CDS",
    body: `INTERNAL seed ${n}`,
    visibility: "internal",
  });
  const file = await pb.collection("support_files").create({
    organization: org,
    thread: thread.id,
    message: message.id,
    name: "photo.png",
    size: 10,
    mime: "image/png",
    ext: "png",
    scan: "clean",
    author_kind: "member",
    // 12-REVIEW CR-A02: a copy of the (public) message's visibility; without it the
    // rowFilter hides the row and org B's own list comes back empty.
    visibility: "public",
    object_key: `tenants/${org}/support/threads/${thread.id}/x.png`,
  });
  const note = await pb.collection("cds_notes").create({
    organization: org,
    title: "Seed note",
    body: "Note body",
    created_by: "stf000000000001",
    author_name: "CDS",
  });
  const doc = await pb.collection("cds_documents").create({
    organization: org,
    title: "Seed doc",
    object_key: `tenants/${org}/support/documents/x.pdf`,
    filename: "x.pdf",
    size: 10,
    mime: "application/pdf",
    ext: "pdf",
    shared_by: "stf000000000001",
    author_name: "CDS",
  });
  const vote = await pb.collection("feature_idea_votes").create({
    organization: org,
    idea,
    voted_by: owner,
  });
  const draft = await pb.collection("held_drafts").create({
    organization: org,
    user: owner,
    kind: "section",
    ref: "seed",
    payload: { n },
  });
  return {
    support_threads: thread.id,
    support_messages: message.id,
    support_files: file.id,
    cds_notes: note.id,
    cds_documents: doc.id,
    feature_idea_votes: vote.id,
    held_drafts: draft.id,
    internal: internal.id,
    number,
    conversation: conversation.id,
    incidentTitle,
  };
}

/** One row per P12 tenant collection in each org, plus org A's internal note. */
export async function seedP12Support(
  pb: PocketBase,
  seed: TwoOrgs,
): Promise<P12SupportSeed> {
  const idea = (
    await pb.collection("feature_ideas").create({
      title: "Seed idea",
      description: "Seed",
      status: "suggested",
      votes: 0,
    })
  ).id;
  const a = await seedOrgRows(pb, seed.A.org, seed.A.owner, idea, 1);
  const b = await seedOrgRows(pb, seed.B.org, seed.B.owner, idea, 2);
  const rows = Object.fromEntries(
    P12_SUPPORT_COLLECTIONS.map((n) => [n, { A: a[n], B: b[n] }]),
  ) as P12SupportSeed["rows"];
  // Org A's Editor: a second person in org A (held drafts belong to one person).
  const password = `Pw-${Math.random().toString(36).slice(2)}-p12`;
  const editor = (
    await pb.collection("users").create({
      email: "p12-editor-a@cds.test",
      password,
      passwordConfirm: password,
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user: editor, organization: seed.A.org, role: "editor" });
  return {
    rows,
    internalA: a.internal,
    idea,
    numbers: { A: a.number, B: b.number },
    conversations: { A: a.conversation, B: b.conversation },
    incidentTitles: { A: a.incidentTitle, B: b.incidentTitle },
    editorA: mintOrgContext({
      orgId: seed.A.org,
      actor: editor,
      role: "editor",
      grants: [],
      ip: IP,
    }),
  };
}

/** The error a call throws (fails the attack when it resolves). */
async function caught(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the call to throw");
}

/** A missing number and another org's number throw the same NotFound, word for word. */
async function sameNotFound(
  attack: () => Promise<unknown>,
  missing: () => Promise<unknown>,
): Promise<void> {
  const foreign = await caught(attack());
  const absent = await caught(missing());
  expect(foreign).toBeInstanceOf(NotFound);
  expect(absent).toBeInstanceOf(NotFound);
  expect(foreign.message).toBe(absent.message);
}

async function messageCount(pb: PocketBase, thread: string): Promise<number> {
  return (
    await pb.collection("support_messages").getList(1, 1, {
      filter: pb.filter("thread = {:t}", { t: thread }),
    })
  ).totalItems;
}

/** Org A's owner as an impersonating staff member (org B's owner id stands in for staff). */
function impersonatedOwnerA(env: AttackEnv): OrgContext {
  const seed = env.seed();
  return mintOrgContext({
    orgId: seed.A.org,
    actor: seed.A.owner,
    role: "owner",
    grants: [],
    impersonator: seed.B.owner,
    ip: IP,
  });
}

/** Org A's owner never sees its own internal note: generic repo, tenant read and poll. */
function internalNoteAttack(
  env: AttackEnv,
  p12: () => P12SupportSeed,
): () => Promise<void> {
  return async () => {
    const seed = env.seed();
    const repo = tenantRepo("support_messages");
    await expect(repo.get(seed.ctxA, p12().internalA)).rejects.toThrow(
      NotFound,
    );
    const all = await repo.list(seed.ctxA, { perPage: 500 });
    expect(all.items.map((r) => r.id)).not.toContain(p12().internalA);
    expect(all.items.every((r) => r.visibility === "public")).toBe(true);
    // A caller filter asking for internal rows is ANDed with the row filter: nothing.
    const probe = await repo.list(seed.ctxA, {
      filter: "visibility = {:v}",
      params: { v: "internal" },
    });
    expect(probe.items).toEqual([]);
    // 12-32: the tenant thread read and the poll leave the internal note out too.
    const thread = p12().rows.support_threads.A;
    const page = await listThreadMessages(seed.ctxA, thread);
    expect(page.messages.length).toBeGreaterThan(0);
    expect(page.messages.map((m) => m.id)).not.toContain(p12().internalA);
    expect(JSON.stringify(page)).not.toContain("INTERNAL seed");
    const poll = await listThreadMessages(seed.ctxA, thread, {
      since: new Date("2000-01-01T00:00:00.000Z"),
    });
    expect(poll.messages.map((m) => m.id)).not.toContain(p12().internalA);
    expect(JSON.stringify(poll)).not.toContain("INTERNAL seed");
  };
}

/** Org B asking for org A's ticket number gets the NotFound a missing number gets. */
function ticketByNumber(
  env: AttackEnv,
  p12: () => P12SupportSeed,
): () => Promise<void> {
  return async () => {
    const { ctxA, ctxB } = env.seed();
    const { numbers } = p12();
    await sameNotFound(
      () => getTicketByNumber(ctxB, numbers.A),
      () => getTicketByNumber(ctxB, 999_999),
    );
    // String forms of the number are the same lookup.
    await expect(getTicketByNumber(ctxB, String(numbers.A))).rejects.toThrow(
      NotFound,
    );
    // Control: each org reads its own ticket.
    expect((await getTicketByNumber(ctxA, numbers.A)).number).toBe(numbers.A);
    expect((await getTicketByNumber(ctxB, numbers.B)).number).toBe(numbers.B);
  };
}

/** Org B cannot reply to, or mark solved, org A's ticket; org A's thread is unchanged. */
function ticketReply(
  env: AttackEnv,
  p12: () => P12SupportSeed,
): () => Promise<void> {
  return async () => {
    resetSupportLimitsForTests();
    const pb = env.pb();
    const { ctxB } = env.seed();
    const { numbers, rows } = p12();
    const thread = rows.support_threads.A;
    const before = await pb.collection("support_threads").getOne(thread);
    const count = await messageCount(pb, thread);
    await sameNotFound(
      () => replyToTicket(ctxB, numbers.A, { body: "Evil reply" }),
      () => replyToTicket(ctxB, 999_999, { body: "Evil reply" }),
    );
    await expect(markTicketSolved(ctxB, numbers.A)).rejects.toThrow(NotFound);
    const after = await pb.collection("support_threads").getOne(thread);
    expect(after.status).toBe(before.status);
    expect(after.updated).toBe(before.updated);
    expect(await messageCount(pb, thread)).toBe(count);
  };
}

/**
 * Org B has no path to org A's conversation: the post always lands in org B's own thread, a
 * read or mark-read of A's thread id is NotFound, and A's staged upload token is refused.
 */
function messagePost(
  env: AttackEnv,
  p12: () => P12SupportSeed,
): () => Promise<void> {
  return async () => {
    resetSupportLimitsForTests();
    const pb = env.pb();
    const { ctxA, ctxB, B } = env.seed();
    const { conversations, rows } = p12();
    const convA = conversations.A;
    const countA = await messageCount(pb, convA);
    const beforeA = await pb.collection("support_threads").getOne(convA);

    const posted = await postConversationMessage(ctxB, {
      body: "Org B writes to CDS",
    });
    expect(posted.conversation.id).toBe(conversations.B);
    expect(posted.conversation.id).not.toBe(convA);
    const row = await pb
      .collection("support_messages")
      .getOne(posted.message.id);
    expect(row.organization).toBe(B.org);
    expect(row.thread).toBe(conversations.B);

    // Reads and marks of org A's threads by id are NotFound.
    for (const id of [convA, rows.support_threads.A]) {
      await expect(listThreadMessages(ctxB, id)).rejects.toThrow(NotFound);
      await expect(markSupportRead(ctxB, id)).rejects.toThrow(NotFound);
    }

    // Org A's staged upload token does not attach to org B's message.
    const dir = await mkdtemp(join(tmpdir(), "cds-attack-p12-"));
    try {
      const store = new LocalDiskStore(dir);
      const staged = await stageSupportUpload(
        ctxA,
        {
          name: "a.png",
          bytes: new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2,
          ]),
        },
        { store, scanner: fakeScanner("clean") },
      );
      await expect(
        postConversationMessage(
          ctxB,
          { body: "Stolen upload", uploadTokens: [staged.token] },
          { store },
        ),
      ).rejects.toThrow(InvalidInput);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    expect(await messageCount(pb, convA)).toBe(countA);
    const afterA = await pb.collection("support_threads").getOne(convA);
    expect(afterA.updated).toBe(beforeA.updated);
  };
}

/** Org B cannot mint or open a link to org A's file id (support_files or cds_documents). */
function fileLink(
  env: AttackEnv,
  p12: () => P12SupportSeed,
  collection: "support_files" | "cds_documents",
): () => Promise<void> {
  return async () => {
    const { ctxA, ctxB } = env.seed();
    const id = p12().rows[collection].A;
    await sameNotFound(
      () => mintSupportFileLink(ctxB, id),
      () => mintSupportFileLink(ctxB, "zzzzzzzzzzzzzzz"),
    );
    // A genuine, unexpired signature for A's id is still NotFound in org B's session.
    const exp = Date.now() + 60_000;
    const sig = signSupportFileLink(id, exp);
    await expect(openSupportFile(ctxB, id, { exp, sig })).rejects.toThrow(
      NotFound,
    );
    // Control: org A mints its own link.
    expect(await mintSupportFileLink(ctxA, id)).toContain(id);
  };
}

/** Org B's vote toggles only org B's row; org A's vote row is untouched. */
function ideaVote(
  env: AttackEnv,
  p12: () => P12SupportSeed,
): () => Promise<void> {
  return async () => {
    const pb = env.pb();
    const { ctxB, A, B } = env.seed();
    const { idea, rows } = p12();
    const voteA = await pb
      .collection("feature_idea_votes")
      .getOne(rows.feature_idea_votes.A);
    const votesOf = async (org: string) =>
      pb.collection("feature_idea_votes").getFullList({
        filter: pb.filter("organization = {:org} && idea = {:i}", {
          org,
          i: idea,
        }),
      });
    // B already voted (seed): toggle removes B's vote, toggle again restores it.
    const off = await toggleIdeaVote(ctxB, idea);
    expect(off.voted).toBe(false);
    expect(await votesOf(B.org)).toHaveLength(0);
    expect((await votesOf(A.org)).map((r) => r.id)).toEqual([voteA.id]);
    const on = await toggleIdeaVote(ctxB, idea);
    expect(on.voted).toBe(true);
    const bRows = await votesOf(B.org);
    expect(bRows).toHaveLength(1);
    expect(bRows[0]!.organization).toBe(B.org);
    const afterA = await pb.collection("feature_idea_votes").getOne(voteA.id);
    expect(afterA.updated).toBe(voteA.updated);
    expect(afterA.voted_by).toBe(A.owner);
  };
}

/** Org A's Editor (and org B) cannot list, discard, undo or apply org A Owner's held draft. */
function heldDraftOtherUser(
  env: AttackEnv,
  p12: () => P12SupportSeed,
): () => Promise<void> {
  return async () => {
    const { ctxA, ctxB } = env.seed();
    const { editorA, rows } = p12();
    const draft = rows.held_drafts.A;
    expect((await listHeldDrafts(editorA)).map((d) => d.id)).not.toContain(
      draft,
    );
    expect((await listHeldDrafts(ctxB)).map((d) => d.id)).not.toContain(draft);
    const deps = {
      sections: { get: () => undefined },
    } as unknown as HeldApplyDeps;
    for (const ctx of [editorA, ctxB]) {
      await expect(discardHeldDraft(ctx, draft)).rejects.toThrow(NotFound);
      await expect(undoDiscardHeldDraft(ctx, draft)).rejects.toThrow(NotFound);
      await expect(applyHeldDraft(ctx, draft, deps)).rejects.toThrow(NotFound);
    }
    // Control: the Owner lists it.
    expect((await listHeldDrafts(ctxA)).map((d) => d.id)).toContain(draft);
  };
}

/** Staff impersonating org A's owner cannot post, upload, file, vote, reply or mark solved. */
function impersonationWrites(
  env: AttackEnv,
  p12: () => P12SupportSeed,
): () => Promise<void> {
  return async () => {
    resetSupportLimitsForTests();
    const ctx = impersonatedOwnerA(env);
    const { numbers, idea } = p12();
    const dir = await mkdtemp(join(tmpdir(), "cds-attack-p12-imp-"));
    try {
      const store = new LocalDiskStore(dir);
      const writes: [string, () => Promise<unknown>][] = [
        ["post", () => postConversationMessage(ctx, { body: "As staff" })],
        [
          "upload",
          () =>
            stageSupportUpload(
              ctx,
              { name: "a.pdf", bytes: new TextEncoder().encode("%PDF-1.7\nx") },
              { store, scanner: fakeScanner("clean") },
            ),
        ],
        [
          "file",
          () =>
            fileTicket(ctx, {
              type: "question",
              subject: "As staff",
              body: "Filed while impersonating",
            }),
        ],
        ["vote", () => toggleIdeaVote(ctx, idea)],
        ["reply", () => replyToTicket(ctx, numbers.A, { body: "As staff" })],
        ["solved", () => markTicketSolved(ctx, numbers.A)],
      ];
      for (const [name, write] of writes) {
        const err = await caught(write());
        expect(err, name).toBeInstanceOf(ImpersonationDenied);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** The incident view of another org's number is NotFound; org A's view holds only A's. */
function incidentView(
  env: AttackEnv,
  p12: () => P12SupportSeed,
): () => Promise<void> {
  return async () => {
    const { ctxA, ctxB } = env.seed();
    const { numbers, incidentTitles } = p12();
    await sameNotFound(
      () => incidentForTicket(ctxB, numbers.A),
      () => incidentForTicket(ctxB, 999_999),
    );
    const view = await incidentForTicket(ctxA, numbers.A);
    expect(view?.title).toBe(incidentTitles.A);
    expect(Object.keys(view ?? {}).sort()).toEqual(
      ["public_text", "status", "title"].sort(),
    );
    expect(JSON.stringify(view)).not.toContain(incidentTitles.B);
  };
}

export function attacks(env: AttackEnv, p12: () => P12SupportSeed): AttackMap {
  return {
    support_threads: readOnlyAttack(env, "support_threads"),
    support_messages: readOnlyAttack(env, "support_messages"),
    "support_messages:internal": internalNoteAttack(env, p12),
    support_files: readOnlyAttack(env, "support_files"),
    cds_notes: readOnlyAttack(env, "cds_notes"),
    cds_documents: readOnlyAttack(env, "cds_documents"),
    feature_idea_votes: readOnlyAttack(env, "feature_idea_votes"),
    held_drafts: readOnlyAttack(env, "held_drafts"),
    // 12-32 function-level attacks.
    "support_threads:by number": ticketByNumber(env, p12),
    "support_threads:reply": ticketReply(env, p12),
    "support_messages:post": messagePost(env, p12),
    "support_files:link": fileLink(env, p12, "support_files"),
    "cds_documents:link": fileLink(env, p12, "cds_documents"),
    "feature_idea_votes:vote": ideaVote(env, p12),
    "held_drafts:other user": heldDraftOtherUser(env, p12),
    "support:impersonation": impersonationWrites(env, p12),
    "incidents:view": incidentView(env, p12),
  };
}
