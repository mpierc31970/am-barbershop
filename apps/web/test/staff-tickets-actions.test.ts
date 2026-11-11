// 13-28 Task 2: Ticket actions (STAFF-05, STAFF-08, STAFF-19, STAFF-20; T-13-28-01..03).
// @cds/db and the staff session are mocked; the real matrix (authorizeStaff inside
// runStaffAction) and the real error mapping run. Proves each control reaches the CLI's
// function with the right input and nothing else.
import { InvalidInput, NotFound } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
const db = vi.hoisted(() => ({
  staffReplyToTicket: vi.fn(),
  staffMarkPaidService: vi.fn(),
  staffLinkTicketToIncident: vi.fn(),
  staffOpenTicket: vi.fn(),
  staffListTickets: vi.fn(),
  staffGetTicket: vi.fn(),
  staffSupportLabels: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock("@cds/addon-registry", () => ({
  ADDON_REGISTRY: { list: () => [{ slug: "events", name: "Events" }] },
}));
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const actions = await import("../app/actions/staff/tickets");
const { kit, resetStaffKit } = await import("./staff-test-kit");

const ORG = "abcdefghijklmno";
const STAFF2 = "staffother00001";

function session(role: "super_admin" | "support_agent" | "") {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: false,
    name: "Mara Agent",
    role,
    maskedEmail: "m•••@example.test",
  };
}

function reply(over: Record<string, unknown> = {}) {
  return {
    messageId: "msg000000000001",
    orgId: ORG,
    recipients: 2,
    raised: 2,
    emailed: 2,
    statusFrom: "open",
    statusTo: "open",
    ...over,
  };
}

function ticketRow(number: number, subject: string, status = "open") {
  return { number, orgName: "Rivera Bakery", subject, status };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  db.staffReplyToTicket.mockResolvedValue(reply());
  db.staffSupportLabels.mockResolvedValue({
    orgs: { [ORG]: "Rivera Bakery" },
    pages: {},
  });
});

describe("session and role gates", () => {
  it("signed out → session_ended, nothing called", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    for (const res of [
      await actions.staffReplyAction({ number: 1042, body: "Hi" }),
      await actions.staffOpenTicketAction({
        orgId: ORG,
        type: "question",
        subject: "S",
        body: "B",
      }),
      await actions.searchTicketsAction("1042"),
      await actions.pollTicketAction(1042, ""),
    ]) {
      expect(res).toEqual({
        ok: false,
        code: "session_ended",
        message: P13_COPY.SESSION_ENDED,
      });
    }
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
    expect(db.staffOpenTicket).not.toHaveBeenCalled();
  });

  it("a non-staff session (member role) is refused REFUSED-ROLE", async () => {
    sess.getStaffSession.mockResolvedValue(session(""));
    expect(
      await actions.staffReplyAction({ number: 1042, body: "Hi" }),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
  });

  it("junk ticket numbers are not_found before any session read", async () => {
    expect(
      await actions.staffReplyAction({ number: "1' OR 1=1", body: "x" }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(sess.getStaffSession).not.toHaveBeenCalled();
  });
});

describe("staffReplyAction", () => {
  it("public reply → staffReplyToTicket and the CLI Sent line", async () => {
    const res = await actions.staffReplyAction({
      number: "#1042",
      body: "Fixed it.",
      status: "waiting_on_you",
    });
    expect(db.staffReplyToTicket).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "u1" }),
      {
        number: 1042,
        internal: false,
        body: "Fixed it.",
        status: "waiting_on_you",
      },
    );
    expect(res).toMatchObject({
      ok: true,
      data: {
        message: "Sent. Rivera Bakery sees it in the hub; 2 alerts raised.",
      },
    });
    expect(kit.revalidated).toContain("/staff");
  });

  it("internal note → internal: true and the CLI saved line", async () => {
    db.staffReplyToTicket.mockResolvedValue(reply({ raised: 0 }));
    const res = await actions.staffReplyAction({
      number: 1042,
      body: "Owner called; refund agreed.",
      internal: true,
    });
    expect(db.staffReplyToTicket.mock.calls[0]?.[1]).toMatchObject({
      internal: true,
    });
    expect(res).toMatchObject({
      ok: true,
      data: { message: "Saved as an internal note. The owner never sees it." },
    });
  });

  it("assign me / priority only → CDS-only line", async () => {
    db.staffReplyToTicket.mockResolvedValue(reply({ raised: 0 }));
    const res = await actions.staffReplyAction({
      number: 1042,
      assign: "me",
      priority: "high",
    });
    expect(db.staffReplyToTicket.mock.calls[0]?.[1]).toEqual({
      number: 1042,
      internal: false,
      assign: "u1",
      priority: "high",
    });
    expect(res).toMatchObject({
      ok: true,
      data: {
        message:
          "Updated. Assignee and priority are CDS-only; nobody was alerted.",
      },
    });
  });

  it("refuses unknown status / priority / assignee", async () => {
    expect(
      await actions.staffReplyAction({ number: 1042, status: "deleted" }),
    ).toMatchObject({ ok: false, code: "invalid_input", field: "status" });
    expect(
      await actions.staffReplyAction({ number: 1042, priority: "max" }),
    ).toMatchObject({ ok: false, code: "invalid_input", field: "priority" });
    expect(
      await actions.staffReplyAction({ number: 1042, assign: "a@b.c" }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
  });

  it("a Closed ticket refusal comes back as the db message", async () => {
    db.staffReplyToTicket.mockRejectedValue(
      new InvalidInput("this ticket is closed"),
    );
    expect(
      await actions.staffReplyAction({ number: 1042, body: "x" }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

describe("staffBulkAction", () => {
  it("bulk assign over 3 numbers calls staffReplyToTicket 3 times, failures per number", async () => {
    db.staffReplyToTicket
      .mockResolvedValueOnce(reply({ raised: 0 }))
      .mockRejectedValueOnce(new NotFound("ticket not found"))
      .mockResolvedValueOnce(reply({ raised: 0 }));
    const res = await actions.staffBulkAction({
      numbers: [1042, 1043, "#1044"],
      assign: STAFF2,
    });
    expect(db.staffReplyToTicket).toHaveBeenCalledTimes(3);
    expect(db.staffReplyToTicket.mock.calls.map((c) => c[1])).toEqual([
      { number: 1042, assign: STAFF2 },
      { number: 1043, assign: STAFF2 },
      { number: 1044, assign: STAFF2 },
    ]);
    expect(res).toEqual({
      ok: true,
      data: {
        message: "2 tickets assigned. 1 didn't change: #1043.",
        changed: 2,
        alerted: 0,
        failed: [{ number: 1043, message: "That ticket wasn't found." }],
      },
    });
  });

  it("assign to me names the staff member; status counts alerts", async () => {
    expect(
      await actions.staffBulkAction({ numbers: [1042], assign: "me" }),
    ).toMatchObject({ data: { message: "1 ticket assigned to Mara." } });
    db.staffReplyToTicket.mockResolvedValue(reply({ raised: 3 }));
    expect(
      await actions.staffBulkAction({
        numbers: [1042, 1043],
        status: "resolved",
      }),
    ).toMatchObject({
      data: {
        message: "2 tickets set to Resolved; 6 alerts raised.",
        alerted: 6,
      },
    });
  });

  it("refuses zero or two changes, empty or oversized selections", async () => {
    expect(await actions.staffBulkAction({ numbers: [1042] })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(
      await actions.staffBulkAction({
        numbers: [1042],
        priority: "high",
        status: "resolved",
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      await actions.staffBulkAction({ numbers: [], priority: "high" }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      await actions.staffBulkAction({
        numbers: Array.from({ length: 101 }, (_, i) => 1001 + i),
        priority: "high",
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.staffReplyToTicket).not.toHaveBeenCalled();
  });
});

describe("paid mark and incident link", () => {
  it("staffMarkPaidAction → staffMarkPaidService", async () => {
    db.staffMarkPaidService.mockResolvedValue({
      orgId: ORG,
      number: 1042,
      raised: 2,
      emailed: 2,
    });
    const res = await actions.staffMarkPaidAction("1042", "photos");
    expect(db.staffMarkPaidService).toHaveBeenCalledWith(expect.anything(), {
      number: 1042,
      category: "photos",
    });
    expect(res).toMatchObject({
      ok: true,
      data: {
        message:
          "Marked as a paid service. Rivera Bakery sees it in the hub; 2 alerts raised.",
      },
    });
    expect(await actions.staffMarkPaidAction(1042, "bogus")).toMatchObject({
      ok: false,
      field: "category",
    });
  });

  it("staffLinkIncidentAction → staffLinkTicketToIncident with the CLI line", async () => {
    db.staffLinkTicketToIncident.mockResolvedValue({
      code: "I-3",
      number: 1042,
      orgId: ORG,
      linked: true,
    });
    const res = await actions.staffLinkIncidentAction(1042, "i-3");
    expect(db.staffLinkTicketToIncident).toHaveBeenCalledWith(
      expect.anything(),
      { incident: "I-3", number: 1042 },
    );
    expect(res).toMatchObject({
      ok: true,
      data: {
        message:
          'Linked #1042 (Rivera Bakery) to I-3. The owner sees "Linked to a known problem" and the public text.',
      },
    });
    expect(await actions.staffLinkIncidentAction(1042, "3")).toMatchObject({
      ok: false,
      field: "incident",
    });
  });
});

describe("staffOpenTicketAction (D210)", () => {
  it("calls staffOpenTicket and returns the new #number, Opened by CDS", async () => {
    db.staffOpenTicket.mockResolvedValue({
      number: 1043,
      id: "thr000000000001",
      raised: 2,
      emailed: 2,
    });
    const res = await actions.staffOpenTicketAction({
      orgId: ORG,
      type: "change",
      subject: "Your holiday hours",
      body: "We noticed the hours are out of date.",
      target: "addon:events",
    });
    expect(db.staffOpenTicket).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "u1" }),
      {
        orgId: ORG,
        type: "change",
        subject: "Your holiday hours",
        body: "We noticed the hours are out of date.",
        target: "addon:events",
        addonNames: { events: "Events" },
      },
    );
    expect(res).toEqual({
      ok: true,
      data: {
        number: 1043,
        message: "Ticket #1043 opened for Rivera Bakery (Opened by CDS).",
      },
    });
  });

  it("refuses a bad org, a suggestion type and missing text", async () => {
    const base = { orgId: ORG, type: "question", subject: "S", body: "B" };
    expect(
      await actions.staffOpenTicketAction({ ...base, orgId: "x" }),
    ).toMatchObject({ code: "not_found" });
    expect(
      await actions.staffOpenTicketAction({ ...base, type: "suggestion" }),
    ).toMatchObject({ code: "invalid_input", field: "type" });
    expect(
      await actions.staffOpenTicketAction({ ...base, body: undefined }),
    ).toMatchObject({ code: "invalid_input", field: "body" });
    expect(db.staffOpenTicket).not.toHaveBeenCalled();
  });
});

describe("searchTicketsAction (D211)", () => {
  it('"#1042" returns ticket 1042 first, then subject matches', async () => {
    db.staffGetTicket.mockResolvedValue(
      ticketRow(1042, "Menu photo", "closed"),
    );
    db.staffListTickets.mockResolvedValue([
      ticketRow(1001, "About 1042 again"),
      ticketRow(1042, "Menu photo", "closed"),
      ticketRow(1050, "Logo"),
    ]);
    const res = await actions.searchTicketsAction("#1042");
    expect(db.staffGetTicket).toHaveBeenCalledWith(expect.anything(), 1042);
    expect(db.staffListTickets).toHaveBeenCalledWith(expect.anything(), {
      status: "all",
    });
    expect(res).toEqual({
      ok: true,
      data: [
        {
          number: 1042,
          orgName: "Rivera Bakery",
          subject: "Menu photo",
          status: "closed",
          href: "/staff/tickets/1042",
        },
      ],
    });
  });

  it("subject search returns at most 5; unknown number is skipped; empty = []", async () => {
    db.staffGetTicket.mockRejectedValue(new NotFound("ticket not found"));
    db.staffListTickets.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ticketRow(1001 + i, `Logo ${i}`)),
    );
    const res = await actions.searchTicketsAction("logo");
    expect(res.ok && res.data).toHaveLength(5);
    expect(db.staffGetTicket).not.toHaveBeenCalled();
    expect(await actions.searchTicketsAction("   ")).toEqual({
      ok: true,
      data: [],
    });
  });
});

describe("pollTicketAction", () => {
  const messages = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
  beforeEach(() => {
    db.staffGetTicket.mockResolvedValue({ status: "in_progress", messages });
  });

  it("returns messages after the cursor and the new cursor", async () => {
    expect(await actions.pollTicketAction(1042, "m1")).toEqual({
      ok: true,
      data: {
        status: "in_progress",
        messages: [{ id: "m2" }, { id: "m3" }],
        cursor: "m3",
        reset: false,
      },
    });
  });

  it("empty cursor = no messages; unknown cursor = full thread with reset", async () => {
    expect(await actions.pollTicketAction(1042, "")).toMatchObject({
      data: { messages: [], cursor: "m3" },
    });
    expect(await actions.pollTicketAction(1042, "gone")).toMatchObject({
      data: { messages, reset: true },
    });
  });
});
