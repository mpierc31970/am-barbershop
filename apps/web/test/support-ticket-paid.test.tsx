// @vitest-environment jsdom
// Ticket detail: paid-service panel (12-26; SUPPORT-03, D297, D-UI-P12-12, D-UI-P12-13;
// T-12-26-01, T-12-26-02). The real page over a mocked session, @cds/db and actions:
//   - Owner, no choice yet: Get a quote is the view's primary, Send reply is secondary; Get a
//     quote calls requestPaidQuoteAction with the number (never an org).
//   - Admin / Editor: PAID-ASK-OWNER, no Get a quote, no Care hour; Send reply stays primary.
//   - Quote sent: View quote links to /hub/settings/quotes/<id> and is the primary.
//   - Care Plan with minutes left: Use my Care hour opens the confirm dialog with Not now
//     focused; confirming calls useCareHourAction.
//   - Show me how opens the category's help article (no action call).
//   - requestPaidQuoteAction maps a Forbidden refusal to PAID-ASK-OWNER.
import type { ReactElement, ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ToastRegion } from "@cds/ui/hub";
import {
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/support/tickets/1042",
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const ORG = "orgaaaaaaaaaaa1";
const ROLES = {
  owner: { orgId: ORG, actor: "u1", role: "owner", grants: [] },
  admin: { orgId: ORG, actor: "u2", role: "admin", grants: [] },
  editor: { orgId: ORG, actor: "u3", role: "editor", grants: [] },
} as const;
type RoleKey = keyof typeof ROLES;

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  getBusinessProfile: vi.fn(),
  getTicketByNumber: vi.fn(),
  listThreadMessages: vi.fn(),
  readSupportRead: vi.fn(),
  paidPanelFor: vi.fn(),
  incidentForTicket: vi.fn(),
  requestPaidQuote: vi.fn(),
  useCareHourForTicket: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const ticketActions = vi.hoisted(() => ({
  fileTicketAction: vi.fn(),
  replyTicketAction: vi.fn(),
  markSolvedAction: vi.fn(),
  undoSolvedAction: vi.fn(),
  markTicketReadAction: vi.fn(),
}));
vi.mock("../app/actions/support-tickets", () => ticketActions);

const supportActions = vi.hoisted(() => ({
  mintSupportFileLinkAction: vi.fn(),
  loadEarlierMessagesAction: vi.fn(),
}));
vi.mock("../app/actions/support", () => supportActions);

const paidActions = vi.hoisted(() => ({
  requestPaidQuoteAction: vi.fn(),
  useCareHourAction: vi.fn(),
}));
vi.mock("../app/actions/support-paid", () => paidActions);

const { default: TicketPage } =
  await import("../app/(platform)/hub/support/tickets/[number]/page");
const { SUPPORT_UI_COPY } = await import("@cds/ui/hub/support");

const THREAD = "thraaaaaaaaaaa1";
const PRIMARY = /(^|\s)bg-hub-accent(\s|$)/;

function asRole(key: RoleKey) {
  sess.requireHubSession.mockResolvedValue({
    ctx: ROLES[key],
    email: "maria@riverabakery.com",
    org: { id: ORG, name: "Rivera Bakery", primaryHost: null },
    orgs: [],
    staleOrg: false,
  });
}

function ticket(over: Record<string, unknown> = {}) {
  return {
    id: THREAD,
    number: 1042,
    type: "change",
    subject: "New photos on the About page",
    status: "waiting_on_you",
    target: { kind: "site", id: "site", label: "Whole site" },
    openedByCds: false,
    paid: { category: "photos", marked_at: "2026-10-10T15:00:00.000Z" },
    incident: null,
    lastActivityAt: "2026-10-10T15:00:00.000Z",
    resolvedAt: null,
    closedAt: null,
    created: "2026-10-09T15:00:00.000Z",
    unread: false,
    firstRepliedAt: null,
    hasIncident: false,
    ...over,
  };
}

type View = Record<string, unknown>;

function view(over: View = {}): View {
  return {
    category: "photos",
    canChoose: true,
    helpId: "media-library",
    quoteRequested: false,
    quoteId: null,
    accepted: false,
    careHourAvailable: false,
    careChosen: false,
    state: "none",
    amountCents: null,
    quoteRequestedAt: null,
    sentAt: null,
    acceptedAt: null,
    careChosenAt: null,
    care: {
      onPlan: false,
      minutesLeft: 0,
      minutesIncluded: 60,
      monthLabel: "October",
    },
    ...over,
  };
}

const ON_PLAN = {
  onPlan: true,
  minutesLeft: 45,
  minutesIncluded: 60,
  monthLabel: "October",
};

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

let mounted: Mounted | null = null;

async function renderTicket(number = "1042"): Promise<HTMLElement> {
  const el = (await TicketPage({
    params: Promise.resolve({ number }),
  })) as ReactElement;
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  await flush();
  return mounted.container;
}

function buttonNamed(root: ParentNode, name: string) {
  return [...root.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  );
}

function sendReply(c: HTMLElement) {
  return buttonNamed(
    c.querySelector("[data-ticket-composer]") ?? c,
    SUPPORT_UI_COPY.BUTTONS.sendReply,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  asRole("owner");
  db.getBusinessProfile.mockResolvedValue({ time_zone: "America/Chicago" });
  db.getTicketByNumber.mockResolvedValue(ticket());
  db.listThreadMessages.mockResolvedValue({ messages: [], hasEarlier: false });
  db.readSupportRead.mockResolvedValue({});
  db.paidPanelFor.mockResolvedValue(view());
  db.incidentForTicket.mockResolvedValue(null);
  for (const fn of Object.values(ticketActions)) {
    fn.mockResolvedValue({ ok: true, data: null });
  }
  paidActions.requestPaidQuoteAction.mockResolvedValue({
    ok: true,
    data: { requested: true },
  });
  paidActions.useCareHourAction.mockResolvedValue({
    ok: true,
    data: { chosen: true },
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("ticket detail: paid-service panel (SUPPORT-03)", () => {
  it("Owner, no choice yet: Get a quote is primary, Send reply secondary", async () => {
    const c = await renderTicket();
    expect(db.paidPanelFor).toHaveBeenCalledWith(ROLES.owner, 1042);
    const panel = c.querySelector("[data-paid-service]");
    expect(panel?.textContent).toContain("This is a paid service");
    expect(panel?.textContent).toContain(SUPPORT_UI_COPY.PAID_RULE);
    const get = buttonNamed(panel!, SUPPORT_UI_COPY.BUTTONS.getQuote)!;
    expect(get.className).toMatch(PRIMARY);
    const send = sendReply(c)!;
    expect(send).toBeDefined();
    expect(send.className).not.toMatch(PRIMARY);
    // Order in the column: panel above the thread and composer.
    const composer = c.querySelector("[data-ticket-composer]")!;
    expect(
      panel!.compareDocumentPosition(composer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    click(get);
    await flush();
    expect(paidActions.requestPaidQuoteAction).toHaveBeenCalledWith(1042);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("Admin and Editor see PAID-ASK-OWNER; Send reply stays primary", async () => {
    for (const role of ["admin", "editor"] as const) {
      asRole(role);
      db.paidPanelFor.mockResolvedValue(view({ canChoose: false, care: null }));
      const c = await renderTicket();
      const panel = c.querySelector("[data-paid-service]")!;
      expect(panel.textContent).toContain(SUPPORT_UI_COPY.PAID_ASK_OWNER);
      expect(buttonNamed(panel, SUPPORT_UI_COPY.BUTTONS.getQuote)).toBe(
        undefined,
      );
      expect(buttonNamed(panel, SUPPORT_UI_COPY.BUTTONS.useCareHour)).toBe(
        undefined,
      );
      expect(sendReply(c)!.className).toMatch(PRIMARY);
      mounted?.unmount();
      mounted = null;
    }
  });

  it("quote sent: View quote links to the quote page and is primary", async () => {
    db.paidPanelFor.mockResolvedValue(
      view({
        state: "quote_sent",
        quoteRequested: true,
        quoteRequestedAt: "2026-10-11T15:00:00.000Z",
        quoteId: "wordaaaaaaaaaa1",
        sentAt: "2026-10-12T15:00:00.000Z",
        amountCents: 12000,
      }),
    );
    const c = await renderTicket();
    const link = [
      ...c.querySelectorAll<HTMLAnchorElement>("[data-paid-service] a"),
    ].find((a) => a.textContent?.trim() === SUPPORT_UI_COPY.BUTTONS.viewQuote)!;
    expect(link.getAttribute("href")).toBe(
      "/hub/settings/quotes/wordaaaaaaaaaa1",
    );
    expect(link.className).toMatch(PRIMARY);
    expect(c.textContent).toContain("$120");
    expect(sendReply(c)!.className).not.toMatch(PRIMARY);
  });

  it("quote requested, not sent: no primary in the panel; Send reply is primary", async () => {
    db.paidPanelFor.mockResolvedValue(
      view({
        state: "quote_requested",
        quoteRequested: true,
        quoteRequestedAt: "2026-10-11T15:00:00.000Z",
      }),
    );
    const c = await renderTicket();
    expect(sendReply(c)!.className).toMatch(PRIMARY);
  });

  it("Care Plan with minutes: the dialog opens with Not now focused; confirm uses the hour", async () => {
    db.paidPanelFor.mockResolvedValue(
      view({ care: ON_PLAN, careHourAvailable: true }),
    );
    const c = await renderTicket();
    const use = buttonNamed(
      c.querySelector("[data-paid-service]")!,
      SUPPORT_UI_COPY.BUTTONS.useCareHour,
    )!;
    click(use);
    await flush();
    const dialog = document.querySelector("dialog")!;
    expect(dialog).not.toBeNull();
    const notNow = buttonNamed(dialog, SUPPORT_UI_COPY.BUTTONS.notNow)!;
    expect(document.activeElement).toBe(notNow);
    expect(paidActions.useCareHourAction).not.toHaveBeenCalled();
    click(buttonNamed(dialog, SUPPORT_UI_COPY.BUTTONS.useCareHour)!);
    await flush();
    expect(paidActions.useCareHourAction).toHaveBeenCalledWith(1042);
  });

  it("Owner without the Care Plan: no Care hour option, the upsell shows", async () => {
    const c = await renderTicket();
    const panel = c.querySelector("[data-paid-service]")!;
    expect(buttonNamed(panel, SUPPORT_UI_COPY.BUTTONS.useCareHour)).toBe(
      undefined,
    );
    expect(panel.querySelector('a[href="/hub/help/care-plan"]')).not.toBeNull();
  });

  it("Show me how opens the category's help article; no action runs", async () => {
    const c = await renderTicket();
    click(buttonNamed(c, SUPPORT_UI_COPY.BUTTONS.showMeHow)!);
    await flush();
    expect(nav.push).toHaveBeenCalledWith("/hub/help/media-library");
    expect(paidActions.requestPaidQuoteAction).not.toHaveBeenCalled();
    expect(paidActions.useCareHourAction).not.toHaveBeenCalled();
  });

  it("an unpaid ticket loads no panel", async () => {
    db.getTicketByNumber.mockResolvedValue(ticket({ paid: null }));
    const c = await renderTicket();
    expect(db.paidPanelFor).not.toHaveBeenCalled();
    expect(c.querySelector("[data-paid-service]")).toBeNull();
    expect(sendReply(c)!.className).toMatch(PRIMARY);
  });

  it("a failed panel load shows the ticket without the panel", async () => {
    db.paidPanelFor.mockRejectedValue(new TypeError("boom"));
    const c = await renderTicket();
    expect(c.querySelector("[data-ticket-detail]")).not.toBeNull();
    expect(c.querySelector("[data-paid-service]")).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      "[hub] ticket paid panel failed TypeError",
    );
  });
});

describe("support-paid actions (T-12-26-01)", () => {
  const session = (key: RoleKey) => ({
    ctx: ROLES[key],
    email: "x@example.com",
    org: { id: ORG, name: "Rivera Bakery", primaryHost: null },
    orgs: [],
    staleOrg: false,
  });

  it("Forbidden comes back as PAID-ASK-OWNER; junk numbers never reach the chokepoint", async () => {
    const real = await vi.importActual<
      typeof import("../app/actions/support-paid")
    >("../app/actions/support-paid");
    const { Forbidden } = await import("@cds/core");
    sess.getHubSession.mockResolvedValue(session("editor"));
    sess.agreementBlocks.mockResolvedValue(false);
    db.requestPaidQuote.mockRejectedValue(new Forbidden("owner only"));
    const res = await real.requestPaidQuoteAction(1042);
    expect(res).toMatchObject({
      ok: false,
      code: "forbidden",
      message: SUPPORT_UI_COPY.PAID_ASK_OWNER,
    });
    expect(db.requestPaidQuote).toHaveBeenCalledWith(ROLES.editor, 1042);

    const junk = await real.useCareHourAction("abc");
    expect(junk.ok).toBe(false);
    expect(db.useCareHourForTicket).not.toHaveBeenCalled();
  });

  it("Owner success passes the session ctx and the parsed number", async () => {
    const real = await vi.importActual<
      typeof import("../app/actions/support-paid")
    >("../app/actions/support-paid");
    sess.getHubSession.mockResolvedValue(session("owner"));
    sess.agreementBlocks.mockResolvedValue(false);
    db.useCareHourForTicket.mockResolvedValue({
      chosen: true,
      minutesLeft: 45,
      monthLabel: "October",
    });
    const res = await real.useCareHourAction("1042");
    expect(res).toEqual({ ok: true, data: { chosen: true } });
    expect(db.useCareHourForTicket).toHaveBeenCalledWith(ROLES.owner, 1042);
  });
});

describe("ticket detail: known problem box (COMM-12, T-12-26-03)", () => {
  const INCIDENT = {
    title: "Contact forms not sending",
    public_text:
      "Some contact forms are not sending email. We are fixing it now.",
    status: "open",
  };

  it("a linked ticket shows title, public text and status above the paid panel", async () => {
    db.getTicketByNumber.mockResolvedValue(ticket({ hasIncident: true }));
    db.incidentForTicket.mockResolvedValue(INCIDENT);
    const c = await renderTicket();
    expect(db.incidentForTicket).toHaveBeenCalledWith(ROLES.owner, 1042);
    const box = c.querySelector("[data-incident-box]")!;
    expect(box.textContent).toContain(
      "Known problem: Contact forms not sending",
    );
    expect(box.textContent).toContain(INCIDENT.public_text);
    expect(box.textContent).toContain("Being fixed");
    // Nothing beyond the public view: no counts, no other ticket numbers.
    expect(box.textContent).not.toMatch(/\d/);
    const panel = c.querySelector("[data-paid-service]")!;
    expect(
      box.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("a fixed incident shows Fixed", async () => {
    db.getTicketByNumber.mockResolvedValue(
      ticket({ hasIncident: true, paid: null, status: "resolved" }),
    );
    db.incidentForTicket.mockResolvedValue({ ...INCIDENT, status: "resolved" });
    const c = await renderTicket();
    expect(c.querySelector("[data-incident-box]")?.textContent).toContain(
      "Fixed",
    );
  });

  it("an unlinked ticket loads and renders no box", async () => {
    const c = await renderTicket();
    expect(db.incidentForTicket).not.toHaveBeenCalled();
    expect(c.querySelector("[data-incident-box]")).toBeNull();
  });

  it("a failed incident load shows the ticket without the box", async () => {
    db.getTicketByNumber.mockResolvedValue(ticket({ hasIncident: true }));
    db.incidentForTicket.mockRejectedValue(new RangeError("down"));
    const c = await renderTicket();
    expect(c.querySelector("[data-ticket-detail]")).not.toBeNull();
    expect(c.querySelector("[data-incident-box]")).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      "[hub] ticket incident failed RangeError",
    );
  });
});
