// 12-04 (COMM-01, COMM-07, T-12-04-01; PLATFORM-DESIGN "easy to get wrong #1"): an internal
// support note never reaches a tenant. One public and one internal message are seeded in
// org A through the raw superuser client; the internal body must be absent from all four
// generic paths: the tenant repository list/get, the exportTenant bundle, the Download my
// data CSV for support_messages, and toSnapshot. Runs on the real PocketBase binary.
import "@cds/addon-registry/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFound } from "@cds/core";
import { strFromU8, strToU8, unzipSync } from "fflate";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintSystemContext } from "../src/context";
import { requestDataDownload, runDataDownloads } from "../src/downloads";
import { exportTenant } from "../src/export";
import { tenantRepo } from "../src/repository";
import { SnapshotForbidden, toSnapshot } from "../src/snapshot";
import { LocalDiskStore } from "../src/storage/local-disk";
import { staffStoreSupportFile } from "../src/support/files";
import { listThreadMessages } from "../src/support/messages";
import { staffGetTicket } from "../src/support/staff-tickets";
import { getTicketByNumber } from "../src/support/threads";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

// 13-28 (STAFF-08, T-13-28-01): the console path. The staff ticket actions run with the
// shared staff test kit (cookie jar + next/* mocks); the actions call @cds/db, the same
// module graph this file imports from.
vi.mock(
  "next/headers",
  async () =>
    (await import("../../../apps/web/test/staff-test-kit")).nextHeadersMock,
);
vi.mock(
  "next/navigation",
  async () =>
    (await import("../../../apps/web/test/staff-test-kit")).nextNavigationMock,
);
vi.mock(
  "next/cache",
  async () =>
    (await import("../../../apps/web/test/staff-test-kit")).nextCacheMock,
);

const INTERNAL = "INTERNAL-NOTE-never-leaves-7c1e";
const PUBLIC = "Public reply from CDS";
const SYS = mintSystemContext({ job: "test" });

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: SupportSeed;
let root: string;
let tmp: string;
let store: LocalDiskStore;
let publicId: string;
let internalId: string;
// 12-REVIEW CR-A02: a staff file on the internal note, and one on the public message.
const INTERNAL_FILE = "refund-dispute-notes-9d2a.pdf";
const PUBLIC_FILE = "Launch-checklist.pdf";
let internalFileId: string;
let publicFileId: string;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedSupport(pb);
  root = await mkdtemp(join(tmpdir(), "cds-notes-store-"));
  tmp = await mkdtemp(join(tmpdir(), "cds-notes-tmp-"));
  store = new LocalDiskStore(root);
  const org = seed.A.org;
  const thread = await pb.collection("support_threads").create({
    organization: org,
    kind: "conversation",
    status: "open",
    subject: "Chat with CDS",
    last_activity_at: new Date().toISOString(),
  });
  publicId = (
    await pb.collection("support_messages").create({
      organization: org,
      thread: thread.id,
      author_kind: "staff",
      author_staff: "stf000000000001",
      author_name: "CDS",
      body: PUBLIC,
      visibility: "public",
    })
  ).id;
  internalId = (
    await pb.collection("support_messages").create({
      organization: org,
      thread: thread.id,
      author_kind: "staff",
      author_staff: "stf000000000001",
      author_name: "CDS",
      body: INTERNAL,
      visibility: "internal",
    })
  ).id;
  const PDF = strToU8("%PDF-1.7\nhello");
  internalFileId = (
    await staffStoreSupportFile(
      seed.staff.agent,
      {
        orgId: org,
        threadId: thread.id,
        messageId: internalId,
        name: INTERNAL_FILE,
        bytes: PDF,
      },
      { store },
    )
  ).id;
  publicFileId = (
    await staffStoreSupportFile(
      seed.staff.agent,
      {
        orgId: org,
        threadId: thread.id,
        messageId: publicId,
        name: PUBLIC_FILE,
        bytes: PDF,
      },
      { store },
    )
  ).id;
});

afterAll(async () => {
  await inst?.stop();
  if (root) await rm(root, { recursive: true, force: true });
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("internal support notes never leave the server (12-04)", () => {
  it("tenantRepo get and list return the public message only", async (ctx) => {
    if (!inst) return ctx.skip();
    const repo = tenantRepo("support_messages");
    for (const role of ["owner", "viewer"] as const) {
      const c = seed.A.ctx[role];
      const list = await repo.list(c, { perPage: 500 });
      expect(list.items.map((r) => r.id)).toEqual([publicId]);
      expect(JSON.stringify(list)).not.toContain(INTERNAL);
      await expect(repo.get(c, internalId)).rejects.toThrow(NotFound);
      expect((await repo.get(c, publicId)).body).toBe(PUBLIC);
    }
  });

  it("the exportTenant bundle carries the public message only", async (ctx) => {
    if (!inst) return ctx.skip();
    const { key, counts } = await exportTenant(seed.A.ctx.owner, seed.A.org, {
      store,
    });
    expect(counts.support_messages).toBe(1);
    const json = new TextDecoder().decode((await store.get(key))!);
    expect(json).toContain(PUBLIC);
    expect(json).not.toContain(INTERNAL);
    expect(json).not.toContain("author_staff");
    expect(json).not.toContain(internalId);
  });

  it("the Download my data support_messages CSV carries the public message only", async (ctx) => {
    if (!inst) return ctx.skip();
    const { id } = await requestDataDownload(seed.A.ctx.owner, { run: false });
    await runDataDownloads(SYS, { org: seed.A.org, store, tmpDir: tmp });
    const row = await pb.collection("data_exports").getOne(id);
    expect(row.status).toBe("ready");
    const files = unzipSync((await store.get(row.object_key))!);
    const name = Object.keys(files).find((f) => /support-messages/.test(f));
    expect(name).toBeDefined();
    const csv = strFromU8(files[name!]!);
    expect(csv).toContain(PUBLIC);
    expect(csv).not.toContain(INTERNAL);
    const all = Object.values(files)
      .map((b) => strFromU8(b))
      .join("\n");
    expect(all).not.toContain(INTERNAL);
    // 12-REVIEW CR-A02: the internal note's file is in no CSV, no file name, no zip entry.
    const csvName = Object.keys(files).find((f) => /support-files/.test(f));
    expect(csvName).toBeDefined();
    expect(strFromU8(files[csvName!]!)).toContain(PUBLIC_FILE);
    const names = Object.keys(files).join("\n");
    for (const hay of [names, all]) {
      expect(hay).not.toContain(INTERNAL_FILE);
      expect(hay).not.toContain(internalFileId);
    }
  });

  it("toSnapshot refuses the internal row and keeps the public one", async (ctx) => {
    if (!inst) return ctx.skip();
    const internal = await pb.collection("support_messages").getOne(internalId);
    expect(() => toSnapshot("support_messages", internal)).toThrow(
      SnapshotForbidden,
    );
    const pub = await pb.collection("support_messages").getOne(publicId);
    const snap = toSnapshot("support_messages", pub);
    expect(snap.body).toBe(PUBLIC);
    expect(JSON.stringify(snap)).not.toContain(INTERNAL);
  });

  // 12-REVIEW CR-A02: files on internal notes are filtered like the notes themselves.
  it("a file on an internal note stays out of the repository and the export bundle", async (ctx) => {
    if (!inst) return ctx.skip();
    const stored = await pb.collection("support_files").getOne(internalFileId);
    expect(stored.visibility).toBe("internal");

    const repo = tenantRepo("support_files");
    const list = await repo.list(seed.A.ctx.owner, { perPage: 500 });
    expect(list.items.map((r) => r.id)).toEqual([publicFileId]);
    await expect(repo.get(seed.A.ctx.owner, internalFileId)).rejects.toThrow(
      NotFound,
    );

    const { key, counts } = await exportTenant(seed.A.ctx.owner, seed.A.org, {
      store,
    });
    expect(counts.support_files).toBe(1);
    const json = new TextDecoder().decode((await store.get(key))!);
    expect(json).toContain(PUBLIC_FILE);
    expect(json).not.toContain(INTERNAL_FILE);
    expect(json).not.toContain(internalFileId);
  });
});

// 13-28 choice 3 (STAFF-08): a note saved from the console (staffReplyAction) on a ticket the
// console opened (staffOpenTicketAction, D210) is absent from every tenant path. Org B, so the
// org A assertions above keep their exact counts.
/** The export JSON with every `audit_log` array removed (wherever it sits). */
function withoutAudit(json: string): string {
  return JSON.stringify(JSON.parse(json), (k, v: unknown) =>
    k === "audit_log" ? undefined : v,
  );
}

describe("console internal notes never reach the tenant (13-28)", () => {
  const CONSOLE_INTERNAL = "CONSOLE-INTERNAL-note-never-leaves-41b9";
  const CONSOLE_PUBLIC = "Console public reply from CDS";
  let number = 0;
  let threadId = "";
  let noteId = "";

  beforeAll(async () => {
    if (!inst) return;
    const kitMod = await import("../../../apps/web/test/staff-test-kit");
    const { resetSignInLimitsForTests } = await import("./staff-users");
    kitMod.resetStaffKit();
    resetSignInLimitsForTests();
    await kitMod.signInStaffForTest(inst, "support_agent");
    const actions = await import("../../../apps/web/app/actions/staff/tickets");
    const opened = await actions.staffOpenTicketAction({
      orgId: seed.B.org,
      type: "question",
      subject: "Checking in",
      body: "Opening this for you.",
    });
    if (!opened.ok) throw new Error(`open refused: ${opened.code}`);
    number = opened.data.number;
    const note = await actions.staffReplyAction({
      number,
      body: CONSOLE_INTERNAL,
      internal: true,
    });
    if (!note.ok) throw new Error(`note refused: ${note.code}`);
    expect(note.data.message).toBe(
      "Saved as an internal note. The owner never sees it.",
    );
    noteId = note.data.messageId ?? "";
    const pub = await actions.staffReplyAction({
      number,
      body: CONSOLE_PUBLIC,
    });
    if (!pub.ok) throw new Error(`reply refused: ${pub.code}`);
  }, 120_000);

  it("staff read shows the note marked internal; the ticket is Opened by CDS", async (ctx) => {
    if (!inst) return ctx.skip();
    const t = await staffGetTicket(seed.staff.agent, number);
    threadId = t.id;
    expect(t.openedByCds).toBe(true);
    const note = t.messages.find((m) => m.id === noteId);
    expect(note?.visibility).toBe("internal");
    expect(note?.body).toBe(CONSOLE_INTERNAL);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:org} && action = 'support.ticket_opened_by_cds'",
        { org: seed.B.org },
      ),
    });
    expect(audit).toHaveLength(1);
  });

  it("getTicketByNumber and listThreadMessages leave it out", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const role of ["owner", "viewer"] as const) {
      const c = seed.B.ctx[role];
      const t = await getTicketByNumber(c, number);
      expect(t.openedByCds).toBe(true);
      expect(JSON.stringify(t)).not.toContain(CONSOLE_INTERNAL);
      const page = await listThreadMessages(c, t.id);
      const bodies = page.messages.map((m) => m.body);
      expect(bodies).toContain(CONSOLE_PUBLIC);
      expect(JSON.stringify(page)).not.toContain(CONSOLE_INTERNAL);
      expect(page.messages.map((m) => m.id)).not.toContain(noteId);
    }
    expect(threadId).not.toBe("");
  });

  it("the export bundle and the data download leave it out", async (ctx) => {
    if (!inst) return ctx.skip();
    const { key } = await exportTenant(seed.B.ctx.owner, seed.B.org, { store });
    const json = new TextDecoder().decode((await store.get(key))!);
    expect(json).toContain(CONSOLE_PUBLIC);
    expect(json).not.toContain(CONSOLE_INTERNAL);
    // The note's id appears only in the P12 support.staff_reply audit meta (no body; logged in
    // deferred-items.md); no message or file row carries it.
    expect(withoutAudit(json)).not.toContain(noteId);

    const { id } = await requestDataDownload(seed.B.ctx.owner, { run: false });
    await runDataDownloads(SYS, { org: seed.B.org, store, tmpDir: tmp });
    const row = await pb.collection("data_exports").getOne(id);
    expect(row.status).toBe("ready");
    const files = unzipSync((await store.get(row.object_key))!);
    const all = [
      ...Object.keys(files),
      ...Object.values(files).map((b) => strFromU8(b)),
    ].join("\n");
    expect(all).toContain(CONSOLE_PUBLIC);
    expect(all).not.toContain(CONSOLE_INTERNAL);
    const messagesCsv = Object.entries(files)
      .filter(([f]) => /support-(messages|files)/.test(f))
      .map(([, b]) => strFromU8(b))
      .join("\n");
    expect(messagesCsv).toContain(CONSOLE_PUBLIC);
    expect(messagesCsv).not.toContain(noteId);
  });
});
