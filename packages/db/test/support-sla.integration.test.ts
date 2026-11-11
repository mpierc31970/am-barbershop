// 12-18: SLA tracking and the support:run job steps on the real PocketBase binary (SUPPORT-02,
// COMM-09). Due dates in business time (America/Chicago), the staff list's at-risk filter,
// first_replied_at set only by a public staff reply, one SLA warning per ticket, and the
// 7-day auto-close with its tenant-reply exception.
import "@cds/addon-registry/server";
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
import { resetSupportLimitsForTests } from "../src/rate-limit";
import {
  SUPPORT_AUTO_CLOSE_MS,
  fileTicket,
  jobAutoCloseTickets,
  jobSlaWarnings,
  staffListTickets,
  staffReplyToTicket,
  staffSetTicketStatus,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

// Friday 16 Oct 2026, 16:00 Chicago (CDT, UTC-5).
const FRI_4PM = new Date("2026-10-16T21:00:00.000Z");
const MON_10AM = new Date("2026-10-19T15:00:00.000Z");
const TUE_1PM = new Date("2026-10-20T18:00:00.000Z");
const TUE_4PM = new Date("2026-10-20T21:00:00.000Z");

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
const savedSupportEmail = process.env.CDS_SUPPORT_EMAIL;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: FRI_4PM });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  resetSupportLimitsForTests();
});

afterEach(() => {
  if (savedSupportEmail === undefined) delete process.env.CDS_SUPPORT_EMAIL;
  else process.env.CDS_SUPPORT_EMAIL = savedSupportEmail;
});

function clock(at: Date) {
  return { now: () => at };
}

async function question(subject: string, at = FRI_4PM): Promise<number> {
  return (
    await fileTicket(
      s.A.ctx.owner,
      { type: "question", subject, body: "How do I change my hours?" },
      { clock: clock(at) },
    )
  ).number;
}

async function threadOf(number: number) {
  return pb
    .collection("support_threads")
    .getFirstListItem(pb.filter("number = {:n}", { n: number }));
}

function date(v: unknown): number {
  return Date.parse(String(v).replace(" ", "T"));
}

describe("SLA state in the staff list", () => {
  it("Fri 16:00 question is due Tue 16:00; due soon at Tue 13:00 and in the at-risk filter", async (t) => {
    if (!inst) return t.skip();
    const n = await question("Hours question");
    const row = await threadOf(n);
    expect(date(row.first_reply_due_at)).toBe(TUE_4PM.getTime());

    const monday = await staffListTickets(s.staff.agent, { now: MON_10AM });
    expect(monday.find((r) => r.number === n)!.sla).toBe("on_track");
    const mondayRisk = await staffListTickets(s.staff.agent, {
      sla: "at-risk",
      now: MON_10AM,
    });
    expect(mondayRisk.map((r) => r.number)).not.toContain(n);

    const tue = await staffListTickets(s.staff.agent, { now: TUE_1PM });
    const r = tue.find((x) => x.number === n)!;
    expect(r.sla).toBe("due_soon");
    expect(r.dueAt).not.toBeNull();
    const risk = await staffListTickets(s.staff.agent, {
      sla: "at-risk",
      now: TUE_1PM,
    });
    expect(risk.map((x) => x.number)).toContain(n);
    // Most urgent first: a due-soon ticket sorts before on-track ones.
    const late = await question("Filed Monday", MON_10AM);
    const order = (await staffListTickets(s.staff.agent, { now: TUE_1PM })).map(
      (x) => x.number,
    );
    expect(order.indexOf(n)).toBeLessThan(order.indexOf(late));

    const missed = await staffListTickets(s.staff.agent, {
      sla: "missed",
      now: new Date(TUE_4PM.getTime() + 60_000),
    });
    expect(missed.map((x) => x.number)).toContain(n);
  });

  it("an internal note does not set first_replied_at; a public reply before due is met", async (t) => {
    if (!inst) return t.skip();
    const n = await question("Reply before due");
    await staffReplyToTicket(
      s.staff.agent,
      { number: n, body: "Checking with the team", internal: true },
      { clock: clock(MON_10AM), transport: captureTransport() },
    );
    expect((await threadOf(n)).first_replied_at).toBe("");
    const before = await staffListTickets(s.staff.agent, { now: TUE_1PM });
    expect(before.find((r) => r.number === n)!.sla).toBe("due_soon");

    await staffReplyToTicket(
      s.staff.agent,
      { number: n, body: "Go to Settings, then Hours." },
      { clock: clock(TUE_1PM), transport: captureTransport() },
    );
    expect(date((await threadOf(n)).first_replied_at)).toBe(TUE_1PM.getTime());
    const after = await staffListTickets(s.staff.agent, {
      now: new Date(TUE_4PM.getTime() + 3_600_000),
    });
    expect(after.find((r) => r.number === n)!.sla).toBe("met");
  });
});

describe("jobSlaWarnings", () => {
  it("emails staff once when a ticket is due soon, and not again on the next run", async (t) => {
    if (!inst) return t.skip();
    process.env.CDS_SUPPORT_EMAIL = "help@cds.test";
    const n = await question("Warn me");
    const transport = captureTransport();

    // Monday: on track, nothing sent.
    await jobSlaWarnings(MON_10AM, { transport });
    expect(transport.sent.filter((m) => m.subject.includes(`#${n}`))).toEqual(
      [],
    );

    const first = await jobSlaWarnings(TUE_1PM, { transport });
    expect(first.warned).toBeGreaterThanOrEqual(1);
    const mine = transport.sent.filter((m) => m.subject.includes(`#${n} `));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.type).toBe("support.sla_risk");
    expect(mine[0]!.to).toBe("help@cds.test");
    expect(mine[0]!.fromName).toBe("CDS Support");
    expect(mine[0]!.text).toContain(`npm run support:show -- --ticket ${n}`);
    expect(mine[0]!.preheader).toContain("today");
    expect(date((await threadOf(n)).sla_warned_at)).toBe(TUE_1PM.getTime());

    const again = new Date(TUE_1PM.getTime() + 3_600_000);
    const second = await jobSlaWarnings(again, { transport });
    expect(second.warned).toBe(0);
    expect(
      transport.sent.filter((m) => m.subject.includes(`#${n} `)),
    ).toHaveLength(1);
  });

  it("without a support address nothing is sent or stamped", async (t) => {
    if (!inst) return t.skip();
    delete process.env.CDS_SUPPORT_EMAIL;
    const n = await question("No address");
    const transport = captureTransport();
    const res = await jobSlaWarnings(TUE_1PM, { transport });
    expect(res.warned).toBe(0);
    expect(res.skipped).toBeGreaterThanOrEqual(1);
    expect(transport.sent).toHaveLength(0);
    expect((await threadOf(n)).sla_warned_at).toBe("");
  });
});

describe("jobAutoCloseTickets (COMM-09)", () => {
  it("closes after 7 days resolved; not at 6 d 23 h; not after a tenant reply", async (t) => {
    if (!inst) return t.skip();
    const now = new Date();
    // Staff resolve (posts the "→ Resolved" line), then backdate resolved_at.
    const resolve = async (n: number, agoMs: number) => {
      const at = new Date(now.getTime() - agoMs);
      await staffSetTicketStatus(
        s.staff.agent,
        { number: n, to: "resolved" },
        { clock: clock(at), transport: captureTransport() },
      );
      const row = await threadOf(n);
      expect(date(row.resolved_at)).toBe(at.getTime());
      return row;
    };
    const old = await question("Resolved 7 days ago", MON_10AM);
    const young = await question("Resolved 6d23h ago", MON_10AM);
    const replied = await question("Tenant replied", MON_10AM);
    const oldRow = await resolve(old, SUPPORT_AUTO_CLOSE_MS + 60_000);
    await resolve(young, SUPPORT_AUTO_CLOSE_MS - 3_600_000);
    const repliedRow = await resolve(replied, 8 * 24 * 3_600_000);
    // A tenant message after resolved_at (written directly: a real reply would reopen).
    await new Promise((r) => setTimeout(r, 5));
    await pb.collection("support_messages").create({
      organization: s.A.org,
      thread: repliedRow.id,
      author_kind: "member",
      author_user: s.A.users.owner,
      author_name: "Owner",
      body: "Actually, one more thing",
      visibility: "public",
      attachments: [],
    });

    const transport = captureTransport();
    const res = await jobAutoCloseTickets(now, { transport });
    expect(res).toEqual({ closed: 1, kept: 1, failed: 0 });
    expect(res.failed).toBe(0);

    const closed = await threadOf(old);
    expect(closed.status).toBe("closed");
    expect(date(closed.closed_at)).toBe(now.getTime());
    expect((await threadOf(young)).status).toBe("resolved");
    expect((await threadOf(replied)).status).toBe("resolved");

    const line = await pb.collection("support_messages").getFullList({
      filter: pb.filter("thread = {:t} && author_kind = 'system'", {
        t: oldRow.id,
      }),
    });
    expect(
      line.map((m) => (m.event as { label?: string } | null)?.label),
    ).toContain("Closed after 7 days with no reply");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'support.ticket_status' && target_id = {:t}",
        { t: oldRow.id },
      ),
    });
    const autoClose = audit.filter(
      (a) => (a.meta as { event?: string }).event === "auto_close",
    );
    expect(autoClose).toHaveLength(1);
    expect(autoClose[0]!.actor).toBe("");

    expect(transport.sent.map((m) => m.subject)).toContain(
      `Ticket #${old} is now Closed`,
    );
    const rows = await pb.collection("alerts").getFullList({
      filter: pb.filter("source_key = {:k}", { k: `support:ticket:${old}` }),
    });
    expect(rows.map((r) => r.user)).toContain(s.A.users.owner);

    const again = await jobAutoCloseTickets(now, { transport });
    expect(again.closed).toBe(0);
  });
});
