// 13-35 Task 2 (STAFF-05, STAFF-08, STAFF-20; T-13-35-01, T-13-35-02): the inbox panel and the
// staff ticket page. @cds/db is mocked (readStaffSession + the support:list / support:show
// reads + incidents); the real staff session, area guard, core inbox params, panels and
// client components run (static render). Proves: URL params reach staffListTickets through
// toStaffListInput and the core refinements narrow the rows; the split pane renders ?open=;
// /staff/tickets/1042 renders the thread with internal notes marked; "#1042" parses; junk and
// unknown numbers 404; the hub never uses the internal variant (source gate) and the tenant
// page keeps reading through the tenant-filtered repository.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NotFound } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { ToastRegion } from "@cds/ui/hub";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { kit, nextSignal, resetStaffKit } from "./staff-test-kit";

vi.mock(
  "next/headers",
  async () => (await import("./staff-test-kit")).nextHeadersMock,
);
vi.mock(
  "next/navigation",
  async () => (await import("./staff-test-kit")).nextNavigationMock,
);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

const db = vi.hoisted(() => ({
  readStaffSession: vi.fn(),
  staffListTickets: vi.fn(),
  staffGetTicket: vi.fn(),
  staffListIncidents: vi.fn(),
  staffListCanned: vi.fn(async () => []),
  staffCannedVarsFor: vi.fn(async () => ({
    first_name: "Maria",
    business: "Rivera Bakery",
    ticket: 1042,
    agent: "Lee",
  })),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { default: InboxPanel } =
  await import("../app/(platform)/staff/(console)/tickets/panels/inbox");
const { default: TicketPage } =
  await import("../app/(platform)/staff/(console)/tickets/[number]/page");
const { default: TicketNotFound } =
  await import("../app/(platform)/staff/(console)/tickets/[number]/not-found");
const { ticketNumberFromSegment, ticketSegmentOf, staffOptionsFrom } =
  await import("../app/(platform)/staff/(console)/tickets/ticket-data");

type Role = "super_admin" | "support_agent";
const ORG = "aaaaaaaaaaaaaaa";
const ME = "u00000000000001";
const MARA = "u00000000000002";

function ctxFor(role: Role) {
  return { kind: "platform", actor: ME, staffRole: role, ip: "203.0.113.21" };
}

function signIn(role: Role = "support_agent") {
  kit.cookies.set("cds_staff", "tok");
  db.readStaffSession.mockResolvedValue({
    ctx: ctxFor(role),
    sessionId: "sess00000000001",
    stepUpFresh: true,
    staffName: "Lee Agent",
    staffEmailMasked: "l•••@example.test",
    createdAt: new Date().toISOString(),
  });
}

function session(role: Role = "support_agent") {
  return {
    ctx: ctxFor(role),
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: true,
    name: "Lee Agent",
    role,
    maskedEmail: "l•••@example.test",
  } as never;
}

async function html(el: Promise<ReactNode> | ReactNode): Promise<string> {
  return renderToStaticMarkup(
    createElement(ToastRegion, null, (await el) as ReactElement),
  );
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: "t00000000001042",
    number: 1042,
    orgId: ORG,
    orgName: "Rivera Bakery",
    type: "problem",
    subject: "Contact form not sending",
    status: "open",
    priority: "normal",
    ageMs: 4 * 3_600_000,
    sla: "on_track",
    dueAt: "2026-10-20T20:00:00.000Z",
    assignee: null,
    assigneeId: null,
    paid: null,
    openedByCds: false,
    ...over,
  };
}

function detail(over: Record<string, unknown> = {}) {
  return {
    ...row(),
    target: { kind: "page", id: "p00000000000001", label: "About us" },
    openedBy: { cds: false, name: "Maria Rivera", userId: "m00000000000001" },
    context: null,
    firstRepliedAt: null,
    resolvedAt: null,
    closedAt: null,
    created: "2026-10-15 11:00:00.000Z",
    incident: null,
    messages: [
      {
        id: "m1",
        authorKind: "member",
        authorName: "Maria",
        body: "The form says sent but nothing arrives.",
        event: null,
        attachments: [],
        created: "2026-10-15 11:00:00.000Z",
        visibility: "public",
        authorStaff: "",
      },
      {
        id: "m2",
        authorKind: "staff",
        authorName: "Mara",
        body: "SES shows a bounce for their inbox.",
        event: null,
        attachments: [],
        created: "2026-10-15 12:00:00.000Z",
        visibility: "internal",
        authorStaff: MARA,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  resetStaffKit();
  for (const f of Object.values(db)) f.mockReset();
  db.staffListIncidents.mockResolvedValue([]);
});

describe("inbox panel", () => {
  it("passes the parsed URL params to staffListTickets via toStaffListInput", async () => {
    db.staffListTickets.mockImplementation(async (_ctx, input) =>
      input.status === "all"
        ? [row(), row({ number: 1043, assigneeId: MARA, assignee: "Mara" })]
        : [
            row(),
            row({ number: 1043, assigneeId: ME, assignee: "Lee" }),
            row({ number: 1044, assigneeId: MARA, assignee: "Mara" }),
          ],
    );
    const out = await html(
      InboxPanel({
        session: session(),
        params: { tab: "inbox", type: "problem", quick: "mine", bogus: "x" },
      }),
    );
    const listCall = db.staffListTickets.mock.calls.find(
      ([, i]) => i.status !== "all",
    )!;
    expect(listCall[1]).toMatchObject({ type: "problem" });
    expect(listCall[1].orgId).toBeUndefined();
    // quick=mine is a core refinement: only #1043 (assigned to me) stays.
    expect(out).toContain("#1043");
    expect(out).not.toContain(">#1044<");
    expect(out).toContain("1 ticket · 0 at risk · 0 missed");
    expect(out).toContain('aria-pressed="true"');
  });

  it("no tickets at all shows INBOX-EMPTY; filters with no match show the filter empty line", async () => {
    db.staffListTickets.mockResolvedValue([]);
    expect(
      await html(InboxPanel({ session: session(), params: { tab: "inbox" } })),
    ).toContain(P13_COPY.INBOX_EMPTY_H);
    expect(
      await html(
        InboxPanel({
          session: session(),
          params: { tab: "inbox", type: "billing" },
        }),
      ),
    ).toContain("No tickets match these filters.");
  });

  it("?open=1042 renders the ticket in the split pane", async () => {
    db.staffListTickets.mockResolvedValue([row()]);
    db.staffGetTicket.mockResolvedValue(detail());
    const out = await html(
      InboxPanel({
        session: session(),
        params: { tab: "inbox", open: "1042" },
      }),
    );
    expect(db.staffGetTicket).toHaveBeenCalledWith(
      expect.anything(),
      1042,
      expect.anything(),
    );
    expect(out).toContain("data-split-detail");
    expect(out).toContain("<h2");
    expect(out).toContain(P13_COPY.INTERNAL_LINE);
  });

  it("a failed list read shows ERR-LOAD with Try again", async () => {
    db.staffListTickets.mockRejectedValue(new Error("boom"));
    const out = await html(
      InboxPanel({ session: session(), params: { tab: "inbox" } }),
    );
    expect(out).toContain("Try again");
  });
});

describe("/staff/tickets/<number>", () => {
  it("renders the thread with internal notes marked and owner text as text", async () => {
    signIn();
    db.staffListTickets.mockResolvedValue([row()]);
    db.staffGetTicket.mockResolvedValue(
      detail({
        subject: "Form <script>x</script>",
      }),
    );
    const out = await html(
      TicketPage({ params: Promise.resolve({ number: "1042" }) }),
    );
    expect(out).toContain("<h1");
    expect(out).toContain("Form &lt;script&gt;x&lt;/script&gt;");
    expect(out).not.toContain("<script>x");
    expect(out).toContain("data-internal");
    expect(out).toContain(P13_COPY.INTERNAL_LINE);
    expect(out).toContain("SES shows a bounce");
    expect(out).toContain("The form says sent but nothing arrives.");
    expect(out).toContain("Back to the inbox");
    // 13-41 fills the composer slot (Reply type radio group, Send reply).
    expect(out).toContain('aria-label="Reply type"');
    expect(out).toContain("Send reply");
    expect(out).toContain("Reply to Maria");
  });

  it('"#1042" (encoded) is parsed; junk and unknown numbers 404', async () => {
    signIn();
    db.staffListTickets.mockResolvedValue([]);
    db.staffGetTicket.mockResolvedValue(detail());
    await html(TicketPage({ params: Promise.resolve({ number: "%231042" }) }));
    expect(db.staffGetTicket).toHaveBeenLastCalledWith(
      expect.anything(),
      1042,
      expect.anything(),
    );
    expect(
      await nextSignal(() =>
        TicketPage({ params: Promise.resolve({ number: "abc" }) }),
      ),
    ).toBe("NEXT_NOT_FOUND");
    db.staffGetTicket.mockRejectedValue(new NotFound("ticket not found"));
    expect(
      await nextSignal(() =>
        TicketPage({ params: Promise.resolve({ number: "9999" }) }),
      ),
    ).toBe("NEXT_NOT_FOUND");
  });

  it("the 404 names the ticket and links back to the inbox", async () => {
    kit.headers["x-cds-path"] = "/staff/tickets/%231042";
    const out = await html(TicketNotFound());
    expect(out).toContain("No ticket #1042.");
    expect(out).toContain('href="/staff/tickets?tab=inbox"');
  });

  it("signed out goes to staff sign-in", async () => {
    const sig = await nextSignal(() =>
      TicketPage({ params: Promise.resolve({ number: "1042" }) }),
    );
    expect(sig).toMatch(/^NEXT_REDIRECT:\/staff\/sign-in/);
  });
});

describe("helpers", () => {
  it("segment parsing and staff options", () => {
    expect(ticketNumberFromSegment("1042")).toBe(1042);
    expect(ticketNumberFromSegment("%231042")).toBe(1042);
    expect(ticketNumberFromSegment("%")).toBeNull();
    expect(ticketSegmentOf("/staff/tickets/1042?x=1")).toBe("1042");
    expect(ticketSegmentOf("/staff/tickets/<b>")).toBeNull();
    expect(
      staffOptionsFrom(
        [
          { assigneeId: MARA, assignee: "Mara" },
          { assigneeId: ME, assignee: "Lee" },
          { assigneeId: null, assignee: null },
        ],
        { ctx: ctxFor("support_agent"), name: "Lee Agent" } as never,
      ),
    ).toEqual([
      { id: ME, name: "Lee" },
      { id: MARA, name: "Mara" },
    ]);
  });
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("hub never renders internal notes (T-13-35-01)", () => {
  it("no hub route or hub component passes variant internal", () => {
    const root = join(__dirname, "..", "..", "..");
    const hits = [
      ...files(join(root, "apps/web/app/(platform)/hub")),
      ...files(join(root, "packages/ui/src/hub")),
    ]
      .filter((f) => !/ThreadMessage\.tsx$|\.test\.tsx?$/.test(f))
      .filter((f) =>
        /variant[=:]\s*\{?\s*["']internal["']/.test(readFileSync(f, "utf8")),
      );
    expect(hits).toEqual([]);
  });

  it("the tenant ticket page reads through the tenant-filtered repository only", () => {
    const src = readFileSync(
      join(
        __dirname,
        "..",
        "app/(platform)/hub/support/tickets/[number]/page.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("listThreadMessages");
    expect(src).not.toMatch(/staffGetTicket|staffListThreadMessages/);
  });
});
