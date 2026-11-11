// 12-32: the phase 12 exit walk on the real PocketBase binary (ROADMAP P12 exit; COMM-01,
// COMM-04, COMM-09, COMM-10, COMM-12). "A tenant files a ticket and follows it to close, and a
// tenant and CDS hold a threaded conversation with an attached document, without email."
//
// Every step is a function call a hub screen or a staff CLI makes. Emails go to a capture
// transport and are only counted: no step reads one to act (no code, no link from an email).
// Files use a fake clean scanner and a temp LocalDiskStore. Clocks are backdated relative to
// real time, because messages carry PocketBase's own `created` (12-18 / 12-31 precedent).
import "@cds/addon-registry/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput } from "@cds/core";
import { SUPPORT_COPY } from "@cds/core/support";
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
import { runSupportJobs } from "../src/jobs/support";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import { LocalDiskStore } from "../src/storage/local-disk";
import {
  SUPPORT_AUTO_CLOSE_MS,
  fileTicket,
  getConversation,
  getTicketByNumber,
  listCdsDocuments,
  listThreadFiles,
  listThreadMessages,
  mintSupportFileLink,
  openSupportFile,
  postConversationMessage,
  replyToTicket,
  stageSupportUpload,
  staffGetTicket,
  staffListThreadMessages,
  staffOpenSupportFile,
  staffPostConversationMessage,
  staffReplyToTicket,
  staffSetTicketStatus,
  staffShareDocument,
  supportNeedsYou,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { fakeScanner } from "./support-fakes";
import { seedSupport, type SupportSeed } from "./support-seed";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3,
]);
const PDF = strToU8("%PDF-1.7\nsigned menu proof");
const STAFF_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 9, 9, 9,
]);
const STAFF_PDF = strToU8("%PDF-1.7\nsite plan from CDS");

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let root: string;
let store: LocalDiskStore;
const savedSupportEmail = process.env.CDS_SUPPORT_EMAIL;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: new Date(Date.now() - 12 * DAY) });
  await pb
    .collection("users")
    .update(s.staff.agentUser, { name: "Mara Lopez" });
  await pb.collection("users").update(s.A.users.editor, { name: "Dana Lee" });
  await pb.collection("users").update(s.A.users.owner, { name: "Ana Ruiz" });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(async () => {
  delete process.env.CDS_SUPPORT_EMAIL;
  resetSupportLimitsForTests();
  root = await mkdtemp(join(tmpdir(), "cds-support-e2e-"));
  store = new LocalDiskStore(root);
});

afterEach(async () => {
  if (savedSupportEmail === undefined) delete process.env.CDS_SUPPORT_EMAIL;
  else process.env.CDS_SUPPORT_EMAIL = savedSupportEmail;
  await rm(root, { recursive: true, force: true });
});

function clock(at: Date) {
  return { now: () => at };
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(...value);
  }
}

/** Mint a link the way the hub does on click, then open it the way the route does. */
async function download(
  ctx: SupportSeed["A"]["ctx"]["owner"],
  id: string,
): Promise<number[]> {
  const path = await mintSupportFileLink(ctx, id);
  const url = new URL(path, "https://cds.test");
  const opened = await openSupportFile(
    ctx,
    id,
    { exp: url.searchParams.get("exp"), sig: url.searchParams.get("sig") },
    { store },
  );
  return bytesOf(opened.stream);
}

async function emailOf(user: string): Promise<string> {
  return String((await pb.collection("users").getOne(user)).email);
}

async function statusOf(number: number): Promise<string> {
  const row = await pb
    .collection("support_threads")
    .getFirstListItem(pb.filter("number = {:n}", { n: number }));
  return String(row.status);
}

describe("P12 exit walk (12-32)", () => {
  it("ticket: file → staff reply → Waiting on you → tenant reply → In progress → resolve → +7 days → Closed", async (t) => {
    if (!inst) return t.skip();
    const now = Date.now();
    const filedAt = new Date(now - 10 * DAY);
    const editor = s.A.ctx.editor;

    // 1. The Editor files a Problem with a screenshot (upload route, then the form).
    const shot = await stageSupportUpload(
      editor,
      { name: "menu-blurry.png", bytes: PNG },
      { store, scanner: fakeScanner("clean") },
    );
    expect(shot.scan).toBe("clean");
    const { number: n, id: threadId } = await fileTicket(
      editor,
      {
        type: "problem",
        subject: "Menu photo is blurry",
        body: "The menu photo on the home page looks blurry on phones.",
        uploadTokens: [shot.token],
      },
      { store, clock: clock(filedAt) },
    );
    expect(await statusOf(n)).toBe("open");
    const filed = await listThreadMessages(editor, threadId);
    expect(filed.messages).toHaveLength(1);
    const screenshot = filed.messages[0]!.attachments[0]!;
    expect(screenshot.name).toBe("menu-blurry.png");
    expect(screenshot.scan).toBe("clean");
    // Staff see the ticket and open the screenshot from the staff CLI.
    const staffView = await staffGetTicket(s.staff.agent, n);
    expect(staffView.number).toBe(n);
    const staffShot = await staffOpenSupportFile(s.staff.agent, screenshot.id, {
      store,
    });
    expect(staffShot.orgId).toBe(s.A.org);
    expect(await bytesOf(staffShot.stream)).toEqual([...PNG]);

    // 2. Staff reply and set Waiting on you.
    const transport = captureTransport();
    const repliedAt = new Date(filedAt.getTime() + HOUR);
    const reply = await staffReplyToTicket(
      s.staff.agent,
      {
        number: n,
        body: "Can you send the original photo?",
        status: "waiting_on_you",
      },
      { store, transport, clock: clock(repliedAt) },
    );
    expect(reply.statusTo).toBe("waiting_on_you");
    expect(await statusOf(n)).toBe("waiting_on_you");

    // Bell row + logged email for filer, Owner and Admin; the hub links straight to the ticket.
    const people = [s.A.users.editor, s.A.users.owner, s.A.users.admin];
    const bell = await pb.collection("alerts").getFullList({
      filter: pb.filter("organization = {:org} && source_key = {:key}", {
        org: s.A.org,
        key: `support:ticket:${n}`,
      }),
    });
    expect(bell.map((r) => r.user).sort()).toEqual([...people].sort());
    for (const row of bell) {
      expect(String(row.href)).toContain(`/support/tickets/${n}`);
    }
    for (const user of people) {
      const addr = await emailOf(user);
      expect(transport.sent.some((m) => m.to === addr)).toBe(true);
    }

    // Needs you on Today: "waiting on you", acted on in the hub (no email needed).
    const needs = await supportNeedsYou(
      editor,
      new Date(repliedAt.getTime() + 5 * MIN),
    );
    const item = needs.find((i) => i.key === `support:ticket:${n}`);
    expect(item?.title).toBe(`Ticket #${n} is waiting on you`);
    expect(item?.actionLabel).toBe("Reply");
    expect(item?.href).toBe(`/hub/support/tickets/${n}`);

    // 3. The Editor replies in the hub: back to CDS (In progress).
    const back = await replyToTicket(
      editor,
      n,
      { body: "Here is the original photo." },
      { store, clock: clock(new Date(repliedAt.getTime() + HOUR)) },
    );
    expect(back.status).toBe("in_progress");
    expect(await statusOf(n)).toBe("in_progress");

    // 4. Staff resolve it 8 days before now.
    const resolvedAt = new Date(now - 8 * DAY);
    await staffSetTicketStatus(
      s.staff.agent,
      { number: n, to: "resolved" },
      { clock: clock(resolvedAt), transport: captureTransport() },
    );
    expect((await getTicketByNumber(editor, n)).status).toBe("resolved");

    // 5. The hourly job one minute short of 7 days leaves it Resolved...
    const jobDeps = {
      store,
      scanner: fakeScanner("clean"),
      transport: captureTransport(),
    };
    const early = await runSupportJobs({
      now: new Date(resolvedAt.getTime() + SUPPORT_AUTO_CLOSE_MS - HOUR),
      ...jobDeps,
    });
    expect(early.failedSteps).toEqual([]);
    expect(await statusOf(n)).toBe("resolved");

    // ...and at 7 days it closes, with the system line the tenant reads.
    const closing = await runSupportJobs({
      now: new Date(resolvedAt.getTime() + SUPPORT_AUTO_CLOSE_MS),
      ...jobDeps,
    });
    expect(closing.failedSteps).toEqual([]);
    expect(closing.closed).toBeGreaterThanOrEqual(1);
    const closed = await getTicketByNumber(editor, n);
    expect(closed.status).toBe("closed");
    const lines = await listThreadMessages(editor, threadId);
    expect(lines.messages.at(-1)!.event).toBe(
      "Closed after 7 days with no reply",
    );

    // 6. A reply on a Closed ticket is refused with the closed note.
    const refused = replyToTicket(editor, n, { body: "One more thing" });
    await expect(refused).rejects.toThrow(InvalidInput);
    await expect(
      replyToTicket(editor, n, { body: "One more thing" }),
    ).rejects.toThrow(SUPPORT_COPY.CLOSED_NOTE);
  });

  it("conversation: tenant and CDS exchange a message and a document both ways, without email", async (t) => {
    if (!inst) return t.skip();
    const now = Date.now();
    const owner = s.A.ctx.owner;
    const transport = captureTransport();

    // 1. The Owner writes to CDS with a PDF attached.
    const up = await stageSupportUpload(
      owner,
      { name: "menu-proof.pdf", bytes: PDF },
      { store, scanner: fakeScanner("clean") },
    );
    const posted = await postConversationMessage(
      owner,
      { body: "Here is the signed menu proof.", uploadTokens: [up.token] },
      { store, clock: clock(new Date(now - 2 * HOUR)) },
    );
    const ownerFile = posted.message.attachments[0]!;
    expect(ownerFile.name).toBe("menu-proof.pdf");
    const conversation = await getConversation(owner);
    expect(conversation?.id).toBe(posted.conversation.id);

    // 2. CDS shares a document (cds:post path) and replies with a file.
    const doc = await staffShareDocument(
      s.staff.agent,
      {
        orgId: s.A.org,
        title: "Site plan",
        note: "The plan we agreed on.",
        filename: "site-plan.pdf",
        bytes: STAFF_PDF,
      },
      { store, transport, clock: clock(new Date(now - HOUR)) },
    );
    const staffMsg = await staffPostConversationMessage(
      s.staff.agent,
      {
        orgId: s.A.org,
        body: "Thanks. Here is the new mockup.",
        files: [{ name: "mockup.png", bytes: STAFF_PNG }],
      },
      { store, transport, clock: clock(new Date(now - 30 * MIN)) },
    );
    expect(staffMsg.threadId).toBe(posted.conversation.id);

    // 3. The Owner reads both in the hub and downloads both CDS files.
    const thread = await listThreadMessages(owner, posted.conversation.id);
    const fromCds = thread.messages.find((m) => m.id === staffMsg.messageId)!;
    expect(fromCds.authorKind).toBe("staff");
    expect(fromCds.authorName).toBe("Mara");
    expect(fromCds.attachments).toHaveLength(1);
    const mockup = fromCds.attachments[0]!;
    expect(mockup.scan).toBe("staff");
    const mine = thread.messages.find((m) => m.id === posted.message.id)!;
    expect(mine.attachments.map((a) => a.id)).toEqual([ownerFile.id]);

    const docs = await listCdsDocuments(owner);
    expect(docs.map((d) => d.id)).toContain(doc.id);
    const files = await listThreadFiles(owner);
    expect(files.map((f) => f.id)).toEqual(
      expect.arrayContaining([mockup.id, ownerFile.id]),
    );

    expect(await download(owner, mockup.id)).toEqual([...STAFF_PNG]);
    expect(await download(owner, doc.id)).toEqual([...STAFF_PDF]);
    // The Owner's own file opens for the Owner too.
    expect(await download(owner, ownerFile.id)).toEqual([...PDF]);

    // 4. The staff side reads the conversation and opens the Owner's file.
    const staffThread = await staffListThreadMessages(s.staff.agent, {
      orgId: s.A.org,
      threadId: posted.conversation.id,
    });
    expect(staffThread.map((m) => m.id)).toEqual(
      expect.arrayContaining([posted.message.id, staffMsg.messageId]),
    );
    const opened = await staffOpenSupportFile(s.staff.agent, ownerFile.id, {
      store,
    });
    expect(opened.orgId).toBe(s.A.org);
    expect(opened.filename).toBe("menu-proof.pdf");
    expect(await bytesOf(opened.stream)).toEqual([...PDF]);

    // Emails were only captured: none carries a file link or a code to act on.
    for (const m of transport.sent) {
      const text = JSON.stringify(m);
      expect(text).not.toContain("/hub/api/support-file/");
      expect(text).not.toContain("sig=");
    }
  });
});
