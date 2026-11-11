// 12-12: the CDS conversation on the real PocketBase binary (COMM-01, COMM-07, COMM-10; D82,
// D93; T-12-12-01..05). One lazy conversation per org (race-safe), member posts with files,
// Viewer read-only, impersonation refused, the 60/hour limiter, public-only scoped reads, the
// poll delta, per-person read state, staff public messages (cds.message) and internal notes.
import "@cds/addon-registry/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
  RateLimited,
} from "@cds/core";
import { strToU8 } from "fflate";
import type PocketBase from "pocketbase";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import {
  SUPPORT_RATE_COPY,
  beginSupportAction,
  resetSupportLimitsForTests,
} from "../src/rate-limit";
import { LocalDiskStore } from "../src/storage/local-disk";
import {
  getConversation,
  listThreadMessages,
  markSupportRead,
  postConversationMessage,
  stageSupportUpload,
  staffListThreadMessages,
  staffPostConversationMessage,
} from "../src/support";
import {
  SUPPORT_READ_DOCUMENTS_KEY,
  SUPPORT_READ_MAX,
  SUPPORT_READ_NOTES_KEY,
  readSupportRead,
  recordSupportRead,
} from "../src/today/prefs";
import { bootPb, type PbInstance } from "./pb-harness";
import { fakeScanner } from "./support-fakes";
import { seedSupport, type SupportSeed } from "./support-seed";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3,
]);
const PDF = strToU8("%PDF-1.7\nhello");
const AT = new Date("2026-10-12T15:00:00.000Z");

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let root: string;
let store: LocalDiskStore;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  await pb
    .collection("users")
    .update(s.staff.agentUser, { name: "Mara Lopez" });
  await pb.collection("users").update(s.A.users.editor, { name: "Dana Lee" });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cds-st-store-"));
  store = new LocalDiskStore(root);
  resetSupportLimitsForTests();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function conversationsOf(org: string) {
  return pb.collection("support_threads").getFullList({
    filter: pb.filter("organization = {:org} && kind = 'conversation'", {
      org,
    }),
  });
}

describe("member conversation (choices 1-5)", () => {
  it("two concurrent first posts create exactly one conversation", async (t) => {
    if (!inst) return t.skip();
    expect(await getConversation(s.B.ctx.owner)).toBeNull();
    const [a, b] = await Promise.all([
      postConversationMessage(s.B.ctx.owner, { body: "Hello from the owner" }),
      postConversationMessage(s.B.ctx.admin, { body: "Hello from the admin" }),
    ]);
    expect(a.conversation.id).toBe(b.conversation.id);
    expect(await conversationsOf(s.B.org)).toHaveLength(1);
    const conv = await getConversation(s.B.ctx.viewer);
    expect(conv?.id).toBe(a.conversation.id);
    const page = await listThreadMessages(s.B.ctx.viewer, conv!.id);
    expect(page.messages.map((m) => m.body).sort()).toEqual([
      "Hello from the admin",
      "Hello from the owner",
    ]);
  });

  it("editor posts with 2 staged files; the message carries 2 attachments", async (t) => {
    if (!inst) return t.skip();
    const scanner = fakeScanner("clean");
    const one = await stageSupportUpload(
      s.A.ctx.editor,
      { name: "shot.png", bytes: PNG },
      { scanner, store },
    );
    const two = await stageSupportUpload(
      s.A.ctx.editor,
      { name: "menu.pdf", bytes: PDF },
      { scanner, store },
    );
    const res = await postConversationMessage(
      s.A.ctx.editor,
      { body: "  See the two files  ", uploadTokens: [one.token, two.token] },
      { store, clock: { now: () => AT } },
    );
    expect(res.message.body).toBe("See the two files");
    expect(res.message.authorKind).toBe("member");
    expect(res.message.authorName).toBe("Dana Lee");
    expect(res.message.attachments.map((a) => a.name).sort()).toEqual([
      "menu.pdf",
      "shot.png",
    ]);
    const files = await pb.collection("support_files").getFullList({
      filter: pb.filter("message = {:m}", { m: res.message.id }),
    });
    expect(files).toHaveLength(2);
    const row = await pb.collection("support_messages").getOne(res.message.id);
    expect(row.attachments).toHaveLength(2);
    const thread = await pb
      .collection("support_threads")
      .getOne(res.conversation.id);
    expect(new Date(thread.last_activity_at).toISOString()).toBe(
      AT.toISOString(),
    );
    expect(thread.last_cds_activity_at).toBeFalsy();

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("target_id = {:id}", { id: res.message.id }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("support.message_posted");
    expect(JSON.stringify(audit[0]!.meta)).not.toContain("See the two files");

    const page = await listThreadMessages(s.A.ctx.viewer, res.conversation.id);
    const listed = page.messages.find((m) => m.id === res.message.id);
    expect(listed?.attachments).toHaveLength(2);
    expect(listed).not.toHaveProperty("visibility");
    expect(listed).not.toHaveProperty("authorStaff");
  });

  it("an empty body needs a file; a bad token leaves no message behind", async (t) => {
    if (!inst) return t.skip();
    await expect(
      postConversationMessage(s.A.ctx.owner, { body: "   " }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      postConversationMessage(s.A.ctx.owner, { body: "x".repeat(5001) }),
    ).rejects.toBeInstanceOf(InvalidInput);
    const before = await pb.collection("support_messages").getFullList({
      filter: pb.filter("organization = {:org}", { org: s.A.org }),
    });
    await expect(
      postConversationMessage(
        s.A.ctx.owner,
        { body: "with a forged file", uploadTokens: ["abc.def"] },
        { store },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    const after = await pb.collection("support_messages").getFullList({
      filter: pb.filter("organization = {:org}", { org: s.A.org }),
    });
    expect(after).toHaveLength(before.length);
  });

  it("a Viewer is Forbidden; an impersonated owner is refused", async (t) => {
    if (!inst) return t.skip();
    await expect(
      postConversationMessage(s.A.ctx.viewer, { body: "Can I post?" }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      postConversationMessage(s.A.impersonatedOwner, { body: "As staff" }),
    ).rejects.toBeInstanceOf(ImpersonationDenied);
  });

  it("the 61st message in an hour is RateLimited with the message copy", async (t) => {
    if (!inst) return t.skip();
    // 60 actions already recorded for this person (the same bucket a post uses).
    for (let i = 0; i < 60; i++) {
      beginSupportAction("message", {
        orgId: s.A.org,
        actorId: s.A.users.admin,
      });
    }
    const err = await postConversationMessage(s.A.ctx.admin, {
      body: "One more",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimited);
    expect((err as Error).message).toBe(SUPPORT_RATE_COPY.message);
    // Another person in the same org is unaffected.
    await expect(
      postConversationMessage(s.A.ctx.owner, { body: "Still fine" }),
    ).resolves.toBeTruthy();
  });

  it("org B cannot read org A's conversation (same NotFound as a missing id)", async (t) => {
    if (!inst) return t.skip();
    const conv = await getConversation(s.A.ctx.owner);
    expect(conv).not.toBeNull();
    await expect(
      listThreadMessages(s.B.ctx.owner, conv!.id),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      listThreadMessages(s.B.ctx.owner, "zzzzzzzzzzzzzzz"),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      markSupportRead(s.B.ctx.owner, conv!.id, AT),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("pages with before / hasEarlier and polls with since", async (t) => {
    if (!inst) return t.skip();
    const conv = (await getConversation(s.A.ctx.owner))!;
    await postConversationMessage(s.A.ctx.owner, { body: "Third message" });
    const all = await listThreadMessages(s.A.ctx.owner, conv.id);
    expect(all.messages.length).toBeGreaterThanOrEqual(3);
    const last2 = await listThreadMessages(s.A.ctx.owner, conv.id, {
      limit: 2,
    });
    expect(last2.messages).toHaveLength(2);
    expect(last2.hasEarlier).toBe(true);
    expect(last2.messages.map((m) => m.id)).toEqual(
      all.messages.slice(-2).map((m) => m.id),
    );
    const older = await listThreadMessages(s.A.ctx.owner, conv.id, {
      before: last2.messages[0]!.created,
    });
    expect(older.messages.map((m) => m.id)).toEqual(
      all.messages.slice(0, -2).map((m) => m.id),
    );
    const cursor = all.messages.at(-1)!.created;
    const none = await listThreadMessages(s.A.ctx.owner, conv.id, {
      since: cursor,
    });
    expect(none.messages).toEqual([]);
    const posted = await postConversationMessage(s.A.ctx.owner, {
      body: "A newer one",
    });
    const delta = await listThreadMessages(s.A.ctx.owner, conv.id, {
      since: cursor,
    });
    expect(delta.messages.map((m) => m.id)).toEqual([posted.message.id]);
    await expect(
      listThreadMessages(s.A.ctx.owner, conv.id, { since: "not a date" }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("Show earlier pages with a (created, id) cursor: same-millisecond rows are never skipped (IN-C07, 12-REVIEW IN-A02)", async (t) => {
    if (!inst) return t.skip();
    const conv = (await getConversation(s.A.ctx.owner))!;
    // One batch: rows saved back to back, often in the same millisecond.
    const batch = pb.createBatch();
    for (let i = 0; i < 12; i++) {
      batch.collection("support_messages").create({
        organization: s.A.org,
        thread: conv.id,
        author_kind: "staff",
        author_name: "CDS",
        body: `Bulk ${i}`,
        visibility: "public",
        attachments: [],
      });
    }
    await batch.send();
    const all = await listThreadMessages(s.A.ctx.owner, conv.id);
    const seen: string[] = [];
    let page = await listThreadMessages(s.A.ctx.owner, conv.id, { limit: 3 });
    seen.unshift(...page.messages.map((m) => m.id));
    while (page.messages.length > 0) {
      const first = page.messages[0]!;
      page = await listThreadMessages(s.A.ctx.owner, conv.id, {
        before: first.created,
        beforeId: first.id,
        limit: 3,
      });
      seen.unshift(...page.messages.map((m) => m.id));
    }
    expect(seen).toEqual(all.messages.map((m) => m.id));
    await expect(
      listThreadMessages(s.A.ctx.owner, conv.id, {
        before: all.messages[0]!.created,
        beforeId: "bad id",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("markSupportRead stores the time per person; an impersonator call is a no-op", async (t) => {
    if (!inst) return t.skip();
    const conv = (await getConversation(s.A.ctx.owner))!;
    await markSupportRead(s.A.ctx.viewer, conv.id, AT);
    expect(await readSupportRead(s.A.ctx.viewer)).toEqual({
      [conv.id]: AT.toISOString(),
    });
    // Never moves backwards.
    await markSupportRead(s.A.ctx.viewer, conv.id, new Date(AT.getTime() - 1));
    expect((await readSupportRead(s.A.ctx.viewer))[conv.id]).toBe(
      AT.toISOString(),
    );
    const before = await readSupportRead(s.A.ctx.owner);
    await markSupportRead(
      s.A.impersonatedOwner,
      conv.id,
      new Date(AT.getTime() + 60_000),
    );
    expect(await readSupportRead(s.A.ctx.owner)).toEqual(before);
    expect(await readSupportRead(s.A.impersonatedOwner)).toEqual({});
  });

  it("the notes and documents read keys are never evicted (12-REVIEW IN-A01)", async (t) => {
    if (!inst) return t.skip();
    const ctx = s.A.ctx.admin;
    const old = new Date(AT.getTime() - 86_400_000);
    await recordSupportRead(ctx, SUPPORT_READ_NOTES_KEY, old);
    await recordSupportRead(ctx, SUPPORT_READ_DOCUMENTS_KEY, old);
    const row = await pb.collection("member_prefs").getFirstListItem(
      pb.filter("organization = {:o} && user = {:u}", {
        o: s.A.org,
        u: ctx.actor,
      }),
    );
    const map: Record<string, string> = { ...row.support_read };
    for (let i = 0; i < SUPPORT_READ_MAX; i++) {
      map[`thread${String(i).padStart(9, "0")}`] = new Date(
        AT.getTime() + i * 1000,
      ).toISOString();
    }
    await pb.collection("member_prefs").update(row.id, { support_read: map });
    await recordSupportRead(
      ctx,
      "newestthread000",
      new Date(AT.getTime() + 3_600_000),
    );
    const after = await readSupportRead(ctx);
    expect(after[SUPPORT_READ_NOTES_KEY]).toBe(old.toISOString());
    expect(after[SUPPORT_READ_DOCUMENTS_KEY]).toBe(old.toISOString());
    expect(after.newestthread000).toBeDefined();
    expect(after.thread000000000).toBeUndefined();
    expect(Object.keys(after)).toHaveLength(SUPPORT_READ_MAX + 2);
  });
});

describe("staff conversation posts (choice 6)", () => {
  it("a public staff message shows as Mara (staff) and alerts owner, admin and editor", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const res = await staffPostConversationMessage(
      s.staff.agent,
      { orgId: s.A.org, body: "Your new menu page is live." },
      { store, transport, clock: { now: () => AT } },
    );
    expect(res.raised).toBe(3);
    const page = await listThreadMessages(s.A.ctx.viewer, res.threadId);
    const m = page.messages.find((x) => x.id === res.messageId);
    expect(m?.authorKind).toBe("staff");
    expect(m?.authorName).toBe("Mara");
    expect(m?.body).toBe("Your new menu page is live.");

    const rows = await pb.collection("alerts").getFullList({
      filter: pb.filter(
        "organization = {:org} && source_key = 'support:messages'",
        { org: s.A.org },
      ),
    });
    expect(rows.map((r) => r.user).sort()).toEqual(
      [s.A.users.owner, s.A.users.admin, s.A.users.editor].sort(),
    );
    expect(rows.every((r) => r.type === "cds.message")).toBe(true);
    expect(transport.sent).toHaveLength(3);

    const thread = await pb.collection("support_threads").getOne(res.threadId);
    expect(new Date(thread.last_cds_activity_at).toISOString()).toBe(
      AT.toISOString(),
    );
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("target_id = {:id}", { id: res.messageId }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.organization).toBe(s.A.org);
    expect(audit[0]!.actor).toBe(s.staff.agentUser);
    const row = await pb.collection("support_messages").getOne(res.messageId);
    expect(row.author_staff).toBe(s.staff.agentUser);
  });

  it("an internal note is absent from tenant reads and the poll; present for staff; no alert", async (t) => {
    if (!inst) return t.skip();
    const conv = (await getConversation(s.A.ctx.owner))!;
    const cursor = (
      await listThreadMessages(s.A.ctx.owner, conv.id)
    ).messages.at(-1)!.created;
    const threadBefore = await pb.collection("support_threads").getOne(conv.id);
    const transport = captureTransport();
    const res = await staffPostConversationMessage(
      s.staff.superAdmin,
      {
        orgId: s.A.org,
        body: "INTERNAL: owner is hard to reach",
        internal: true,
        files: [{ name: "notes.txt", bytes: strToU8("private notes") }],
      },
      { store, transport },
    );
    expect(res.raised).toBe(0);
    expect(transport.sent).toHaveLength(0);

    for (const role of ["owner", "viewer"] as const) {
      const page = await listThreadMessages(s.A.ctx[role], conv.id);
      expect(JSON.stringify(page)).not.toContain("INTERNAL");
      const delta = await listThreadMessages(s.A.ctx[role], conv.id, {
        since: cursor,
      });
      expect(delta.messages.map((m) => m.id)).not.toContain(res.messageId);
    }
    const threadAfter = await pb.collection("support_threads").getOne(conv.id);
    expect(threadAfter.last_activity_at).toBe(threadBefore.last_activity_at);

    const staff = await staffListThreadMessages(s.staff.agent, {
      orgId: s.A.org,
      threadId: conv.id,
    });
    const note = staff.find((m) => m.id === res.messageId);
    expect(note?.visibility).toBe("internal");
    expect(note?.body).toBe("INTERNAL: owner is hard to reach");
    expect(note?.attachments.map((a) => a.scan)).toEqual(["staff"]);
    await expect(
      staffListThreadMessages(s.staff.agent, {
        orgId: s.B.org,
        threadId: conv.id,
      }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("every staff role holds cds_post; a member context is not a staff context", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffPostConversationMessage(
        s.A.ctx.owner as never,
        { orgId: s.A.org, body: "spoof" },
        { store },
      ),
    ).rejects.toThrow();
  });
});
