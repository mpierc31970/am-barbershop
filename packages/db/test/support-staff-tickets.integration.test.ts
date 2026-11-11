// 12-18: staff side of tickets on the real PocketBase binary (COMM-06, COMM-10, SUPPORT-02;
// D210; T-12-18-01..04). Staff reply (public / internal, status, assign, priority, files), the
// alerts each raises, the paid-service guard, open on a tenant's behalf, and the full staff read.
import "@cds/addon-registry/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput, NotFound } from "@cds/core";
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
import { mintPlatformContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import { LocalDiskStore } from "../src/storage/local-disk";
import {
  fileTicket,
  getTicketByNumber,
  listThreadMessages,
  staffGetTicket,
  staffListTickets,
  staffOpenTicket,
  staffReplyToTicket,
  staffSetTicketStatus,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z"); // Monday 10:00 Chicago

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
  root = await mkdtemp(join(tmpdir(), "cds-staff-tickets-"));
  store = new LocalDiskStore(root);
  resetSupportLimitsForTests();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function clock(at: Date) {
  return { now: () => at };
}

async function file(subject: string, at = AT): Promise<number> {
  const r = await fileTicket(
    s.A.ctx.editor,
    { type: "problem", subject, body: "The menu photo looks blurry." },
    { clock: clock(at) },
  );
  return r.number;
}

async function threadOf(number: number) {
  return pb
    .collection("support_threads")
    .getFirstListItem(pb.filter("number = {:n}", { n: number }));
}

async function bellRows(number: number) {
  return pb.collection("alerts").getFullList({
    filter: pb.filter("organization = {:org} && source_key = {:key}", {
      org: s.A.org,
      key: `support:ticket:${number}`,
    }),
  });
}

async function emailOf(user: string): Promise<string> {
  return String((await pb.collection("users").getOne(user)).email);
}

describe("staffReplyToTicket (choice 1)", () => {
  it("public reply + Waiting on you: filer, owner, admin get one bell row and two emails; viewer none", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Menu photo is blurry");
    const transport = captureTransport();
    const at = new Date(AT.getTime() + 3_600_000);
    const res = await staffReplyToTicket(
      s.staff.agent,
      {
        number: n,
        body: "Can you send the original photo?",
        status: "waiting_on_you",
        files: [{ name: "proof.txt", bytes: strToU8("before and after") }],
      },
      { store, transport, clock: clock(at) },
    );
    expect(res.statusFrom).toBe("open");
    expect(res.statusTo).toBe("waiting_on_you");
    expect(res.recipients).toBe(3);
    expect(res.emailed).toBe(6);

    const people = [s.A.users.editor, s.A.users.owner, s.A.users.admin];
    const rows = await bellRows(n);
    expect(rows.map((r) => r.user).sort()).toEqual([...people].sort());
    const addrs = await Promise.all(people.map(emailOf));
    for (const a of addrs) {
      const mine = transport.sent.filter((m) => m.to === a);
      expect(mine.map((m) => m.subject).sort()).toEqual(
        [
          `CDS replied to ticket #${n}`,
          `Ticket #${n} is now Waiting on you`,
        ].sort(),
      );
    }
    const viewer = await emailOf(s.A.users.viewer);
    expect(transport.sent.map((m) => m.to)).not.toContain(viewer);

    const row = await threadOf(n);
    expect(row.status).toBe("waiting_on_you");
    expect(Date.parse(String(row.first_replied_at).replace(" ", "T"))).toBe(
      at.getTime(),
    );
    expect(row.last_cds_activity_at).not.toBe("");

    // Tenant sees "Mara" and the file; the system line follows the reply.
    const tenant = await listThreadMessages(s.A.ctx.owner, row.id);
    const staffMsg = tenant.messages.find((m) => m.authorKind === "staff")!;
    expect(staffMsg.authorName).toBe("Mara");
    expect(staffMsg.attachments).toHaveLength(1);
    expect(staffMsg.attachments[0]!.scan).toBe("staff");
    expect(tenant.messages.at(-1)!.event).toBe(
      "CDS changed the status to Waiting on you",
    );

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'support.staff_reply' && target_id = {:t}", {
        t: row.id,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(s.staff.agentUser);
    expect(audit[0]!.organization).toBe(s.A.org);
    expect(JSON.stringify(audit[0]!.meta)).not.toContain("original photo");

    // A second public reply a minute later: one more email each, still one row per person.
    const second = captureTransport();
    await staffReplyToTicket(
      s.staff.agent,
      { number: n, body: "Any luck finding it?" },
      {
        store,
        transport: second,
        clock: clock(new Date(at.getTime() + 60_000)),
      },
    );
    expect(second.sent.map((m) => m.to).sort()).toEqual([...addrs].sort());
    expect(await bellRows(n)).toHaveLength(3);
    // first_replied_at is not moved by later replies.
    expect((await threadOf(n)).first_replied_at).toBe(row.first_replied_at);
  });

  it("a reply with files stays hidden from members until its files are attached (12-REVIEW WR-A06)", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Logo looks stretched");
    const threadId = (await threadOf(n)).id;
    const body = "Here is the fixed logo.";
    const seenDuringUpload: number[] = [];
    const watching = Object.create(store) as LocalDiskStore;
    watching.put = async (...args: Parameters<LocalDiskStore["put"]>) => {
      const page = await listThreadMessages(s.A.ctx.owner, threadId);
      seenDuringUpload.push(
        page.messages.filter((m) => m.body === body).length,
      );
      return store.put(...args);
    };
    await staffReplyToTicket(
      s.staff.agent,
      {
        number: n,
        body,
        files: [
          { name: "logo-a.txt", bytes: strToU8("a") },
          { name: "logo-b.txt", bytes: strToU8("b") },
        ],
      },
      { store: watching, transport: captureTransport(), clock: clock(AT) },
    );
    expect(seenDuringUpload).toEqual([0, 0]);
    const after = await listThreadMessages(s.A.ctx.owner, threadId);
    const msg = after.messages.find((m) => m.body === body)!;
    expect(msg.attachments).toHaveLength(2);

    // A failed upload: the member never saw the message, and it is gone.
    const failing = Object.create(store) as LocalDiskStore;
    failing.put = async () => {
      const page = await listThreadMessages(s.A.ctx.owner, threadId);
      seenDuringUpload.push(
        page.messages.filter((m) => m.body === "Never shown").length,
      );
      throw new Error("StoreDown");
    };
    await expect(
      staffReplyToTicket(
        s.staff.agent,
        {
          number: n,
          body: "Never shown",
          files: [{ name: "x.txt", bytes: strToU8("x") }],
        },
        { store: failing, transport: captureTransport(), clock: clock(AT) },
      ),
    ).rejects.toThrow();
    expect(seenDuringUpload).toEqual([0, 0, 0]);
    expect(
      await pb.collection("support_messages").getFullList({
        filter: pb.filter("thread = {:t} && body = 'Never shown'", {
          t: threadId,
        }),
      }),
    ).toHaveLength(0);
  });

  it("an internal note with assign + priority: tenant reads unchanged, nobody alerted, staff sees it", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Hours are wrong");
    const before = await threadOf(n);
    const tenantBefore = await getTicketByNumber(s.A.ctx.owner, n);
    const msgsBefore = await listThreadMessages(s.A.ctx.owner, before.id);
    const transport = captureTransport();
    const res = await staffReplyToTicket(
      s.staff.agent,
      {
        number: n,
        body: "INTERNAL: owner prefers phone calls",
        internal: true,
        assign: "support-agent@cds.test",
        priority: "high",
      },
      { store, transport, clock: clock(AT) },
    );
    expect(res.raised).toBe(0);
    expect(transport.sent).toHaveLength(0);
    expect(await bellRows(n)).toHaveLength(0);

    expect(await getTicketByNumber(s.A.ctx.owner, n)).toEqual(tenantBefore);
    const msgsAfter = await listThreadMessages(s.A.ctx.owner, before.id);
    expect(msgsAfter).toEqual(msgsBefore);
    expect(JSON.stringify(msgsAfter)).not.toContain("INTERNAL");

    const after = await threadOf(n);
    expect(after.first_replied_at).toBe("");
    expect(after.assignee).toBe(s.staff.agentUser);
    expect(after.priority).toBe("high");
    expect(after.last_cds_activity_at).toBe(before.last_cds_activity_at);

    const detail = await staffGetTicket(s.staff.agent, n);
    const note = detail.messages.find((m) => m.id === res.messageId)!;
    expect(note.visibility).toBe("internal");
    expect(note.body).toContain("INTERNAL");
    expect(detail.assignee).toBe("Mara");
    expect(detail.priority).toBe("high");
    expect(detail.orgId).toBe(s.A.org);
    expect(detail.openedBy).toMatchObject({ cds: false, name: "Dana Lee" });
  });

  it("refuses: unknown assignee, closed tickets, empty change, unknown number", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Refusals");
    await expect(
      staffReplyToTicket(s.staff.agent, { number: n, assign: "nobody@x.test" }),
    ).rejects.toBeInstanceOf(InvalidInput);
    // A member is not staff.
    await expect(
      staffReplyToTicket(s.staff.agent, { number: n, assign: s.A.users.owner }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffReplyToTicket(s.staff.agent, { number: n }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffReplyToTicket(s.staff.agent, { number: 999_999, body: "hi" }),
    ).rejects.toBeInstanceOf(NotFound);
    await staffSetTicketStatus(s.staff.agent, { number: n, to: "closed" });
    await expect(
      staffReplyToTicket(s.staff.agent, { number: n, body: "late" }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("paid-marked, not accepted: In progress is refused, nothing written (T-12-18-04)", async (t) => {
    if (!inst) return t.skip();
    const n = await file("New logo please");
    const row = await threadOf(n);
    await pb.collection("support_threads").update(row.id, {
      paid_service: { category: "logos", marked_at: AT.toISOString() },
    });
    const transport = captureTransport();
    await expect(
      staffSetTicketStatus(
        s.staff.agent,
        { number: n, to: "in_progress" },
        { transport },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffReplyToTicket(
        s.staff.agent,
        { number: n, body: "Starting now", status: "in_progress" },
        { store, transport },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    expect((await threadOf(n)).status).toBe("open");
    expect(transport.sent).toHaveLength(0);
    const msgs = await pb.collection("support_messages").getFullList({
      filter: pb.filter("thread = {:t}", { t: row.id }),
    });
    expect(msgs).toHaveLength(1);
  });

  it("refuses a context that was not minted, or a staff role without the feature", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Auth");
    await expect(
      staffReplyToTicket({ actor: "x", staffRole: "super_admin" } as never, {
        number: n,
        body: "hi",
      }),
    ).rejects.toThrow();
    const noRole = mintPlatformContext({
      actor: s.staff.agentUser,
      staffRole: "" as never,
      ip: "127.0.0.1",
    });
    await expect(
      staffReplyToTicket(noRole, { number: n, body: "hi" }),
    ).rejects.toThrow();
  });
});

describe("staffOpenTicket (choice 3, D210)", () => {
  it("opens for org A: Opened by CDS, already answered, owner/admin alerted, audited", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const res = await staffOpenTicket(
      s.staff.agent,
      {
        orgId: s.A.org,
        type: "change",
        subject: "Holiday hours update",
        body: "We noticed your holiday hours are missing. Want us to add them?",
        target: `page:${s.A.livePage}`,
      },
      { store, transport, clock: clock(AT) },
    );
    expect(res.number).toBeGreaterThan(1000);
    expect(res.raised).toBe(2);

    const tenant = await getTicketByNumber(s.A.ctx.owner, res.number);
    expect(tenant.openedByCds).toBe(true);
    expect(tenant.status).toBe("open");
    expect(tenant.firstRepliedAt).not.toBeNull();
    expect(tenant.target).toMatchObject({ kind: "page", id: s.A.livePage });

    const row = await threadOf(res.number);
    expect(row.opened_by_staff).toBe(s.staff.agentUser);
    expect(row.opened_by).toBe("");

    const owner = await emailOf(s.A.users.owner);
    const admin = await emailOf(s.A.users.admin);
    expect(transport.sent.map((m) => m.to).sort()).toEqual(
      [owner, admin].sort(),
    );

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'support.ticket_opened_by_cds' && target_id = {:t}",
        { t: row.id },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(s.staff.agentUser);
    expect(audit[0]!.organization).toBe(s.A.org);

    const detail = await staffGetTicket(s.staff.agent, res.number);
    expect(detail.openedBy).toMatchObject({ cds: true, name: "CDS · Mara" });
    expect(detail.messages[0]!.authorKind).toBe("staff");
    expect(detail.sla).toBe("none");
  });

  it("refuses another org's page as the target, suggestions, and a missing org", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffOpenTicket(s.staff.agent, {
        orgId: s.A.org,
        type: "problem",
        subject: "x",
        body: "y",
        target: `page:${s.B.livePage}`,
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffOpenTicket(s.staff.agent, {
        orgId: s.A.org,
        type: "suggestion",
        subject: "x",
        body: "y",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffOpenTicket(s.staff.agent, {
        orgId: "zzzzzzzzzzzzzzz",
        type: "problem",
        subject: "x",
        body: "y",
      }),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

describe("staffListTickets (choice 4)", () => {
  it("lists every org, filters by org and status", async (t) => {
    if (!inst) return t.skip();
    const b = await fileTicket(
      s.B.ctx.owner,
      { type: "question", subject: "B question", body: "How do I?" },
      { clock: clock(AT) },
    );
    const all = await staffListTickets(s.staff.agent, { now: AT });
    expect(all.some((r) => r.orgId === s.A.org)).toBe(true);
    const bRow = all.find((r) => r.number === b.number)!;
    expect(bRow.orgId).toBe(s.B.org);
    expect(bRow.sla).toBe("on_track");
    expect(all.every((r) => r.status !== "closed")).toBe(true);

    const onlyB = await staffListTickets(s.staff.agent, {
      orgId: s.B.org,
      now: AT,
    });
    expect(onlyB.every((r) => r.orgId === s.B.org)).toBe(true);
    const closed = await staffListTickets(s.staff.agent, {
      status: "closed",
      now: AT,
    });
    expect(closed.every((r) => r.status === "closed")).toBe(true);
    expect(closed.length).toBeGreaterThan(0);
  });
});
