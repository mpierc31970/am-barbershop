// @vitest-environment jsdom
// Ticket screens (12-20; COMM-06, COMM-07, COMM-08, COMM-09, SUPPORT-02; 12-UI-SPEC "Get help
// form" 376-417, "Ticket detail" 421-455). The real pages over a mocked session, @cds/db and
// ticket actions:
//   - Get help: Editor sees 4 type cards (no Billing), Owner 5; Change request shows PAID-RULE;
//     Problem shows SLA-LINE; a Viewer / impersonator gets no form; submit calls the action
//     with `from` and never an org; `?ref` prefills the follow-up line; a foreign `?target` is
//     ignored; RATE-TICKETS on a rate limit.
//   - fileTicketAction passes the request's own User-Agent and `fromUrl` to fileTicket.
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
  submit,
  typeInto,
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
  usePathname: () => "/hub/support/tickets/new",
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

const ROLES = {
  owner: { orgId: "orgaaaaaaaaaaa1", actor: "u1", role: "owner", grants: [] },
  editor: { orgId: "orgaaaaaaaaaaa1", actor: "u3", role: "editor", grants: [] },
  viewer: { orgId: "orgaaaaaaaaaaa1", actor: "u4", role: "viewer", grants: [] },
  impersonating: {
    orgId: "orgaaaaaaaaaaa1",
    actor: "u1",
    role: "owner",
    grants: [],
    impersonator: "staff1",
  },
} as const;
type RoleKey = keyof typeof ROLES;

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  activeAddons: vi.fn(),
  getBusinessProfile: vi.fn(),
  getOrgStage: vi.fn(),
  ticketTargets: vi.fn(),
  listIdeas: vi.fn(),
  getTicketByNumber: vi.fn(),
  listThreadMessages: vi.fn(),
  readSupportRead: vi.fn(),
  fileTicket: vi.fn(),
  markSupportRead: vi.fn(),
  replyToTicket: vi.fn(),
  markTicketSolved: vi.fn(),
  undoMarkTicketSolved: vi.fn(),
}));
vi.mock("@cds/db", () => db);

vi.mock("../lib/help-index", () => ({
  buildHelpIndex: () => [
    {
      id: "hours",
      title: "Change your opening hours",
      summary: "Set the hours your site shows.",
      href: "/hub/help/hours",
      audience: "all",
      group: "site",
      howTo: "hours.md",
    },
  ],
}));

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

const { default: NewTicketPage } =
  await import("../app/(platform)/hub/support/tickets/new/page");

const { default: TicketPage } =
  await import("../app/(platform)/hub/support/tickets/[number]/page");
const { NotFound } = await import("@cds/core");

const TARGETS = [
  {
    label: "Your site",
    options: [{ kind: "site", id: "site", label: "Whole site" }],
  },
  {
    label: "Pages",
    options: [{ kind: "page", id: "pageaaaaaaaaaa1", label: "About us" }],
  },
  {
    label: "Site parts",
    options: [
      { kind: "part", id: "header", label: "Header" },
      { kind: "part", id: "footer", label: "Footer" },
      { kind: "part", id: "menus", label: "Menus" },
    ],
  },
];

function useRole(key: RoleKey) {
  sess.requireHubSession.mockResolvedValue({
    ctx: ROLES[key],
    email: "maria@riverabakery.com",
    org: { id: "orgaaaaaaaaaaa1", name: "Rivera Bakery", primaryHost: null },
    orgs: [],
    staleOrg: false,
  });
}

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

async function renderNew(
  params: Record<string, string> = {},
): Promise<HTMLElement> {
  const el = (await NewTicketPage({
    searchParams: Promise.resolve(params),
  })) as ReactElement;
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  await flush();
  return mounted.container;
}

function typeCards(c: HTMLElement): string[] {
  return [
    ...c.querySelectorAll<HTMLInputElement>("[data-ticket-types] input"),
  ].map((i) => i.value);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useRole("owner");
  db.activeAddons.mockResolvedValue([]);
  db.getOrgStage.mockResolvedValue({ stage: "live" });
  db.getBusinessProfile.mockResolvedValue({ time_zone: "America/Chicago" });
  db.ticketTargets.mockResolvedValue(TARGETS);
  db.listIdeas.mockResolvedValue([]);
  ticketActions.fileTicketAction.mockResolvedValue({
    ok: true,
    data: { number: 1042, type: "problem" },
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("/hub/support/tickets/new (COMM-06, COMM-08)", () => {
  it("Owner: back link, H1, five type cards with Billing, nothing preselected", async () => {
    const c = await renderNew();
    expect(c.querySelector("h1")?.textContent).toBe("Get help");
    expect(c.querySelector('a[href="/hub/support"]')?.textContent).toContain(
      "Support",
    );
    expect(typeCards(c)).toEqual([
      "problem",
      "change",
      "question",
      "billing",
      "suggestion",
    ]);
    expect(
      [
        ...c.querySelectorAll<HTMLInputElement>("[data-ticket-types] input"),
      ].some((i) => i.checked),
    ).toBe(false);
    expect(c.textContent).toContain(
      "We include the screen you came from and your browser, to help us look into it.",
    );
  });

  it("Editor: four type cards, no Billing", async () => {
    useRole("editor");
    const c = await renderNew();
    expect(typeCards(c)).toEqual([
      "problem",
      "change",
      "question",
      "suggestion",
    ]);
  });

  it("Viewer and impersonating staff get no form", async () => {
    useRole("viewer");
    let c = await renderNew();
    expect(c.querySelector("form")).toBeNull();
    expect(c.textContent).toContain(
      "You can read support but not write. Ask your site owner for Editor access.",
    );
    mounted?.unmount();
    useRole("impersonating");
    c = await renderNew();
    expect(c.querySelector("form")).toBeNull();
    expect(c.textContent).toContain("You're viewing as support staff");
    expect(db.ticketTargets).not.toHaveBeenCalled();
  });

  it("Change request shows the paid-service rule; Problem shows SLA-LINE", async () => {
    const c = await renderNew();
    expect(c.querySelector("[data-paid-rule]")).toBeNull();
    click(c.querySelector('input[value="change"]'));
    const rule = c.querySelector("[data-paid-rule]");
    expect(rule?.textContent).toContain(
      "Things you can do in your dashboard are yours; we'll show you how. Doing it for you is a paid service.",
    );
    expect(rule?.closest("[data-cds-identity]")).not.toBeNull();
    expect(c.querySelector("[data-ticket-reply-line]")?.textContent).toBe(
      "Support replies here and lets you know by email.",
    );
    click(c.querySelector('input[value="problem"]'));
    expect(c.querySelector("[data-paid-rule]")).toBeNull();
    expect(c.querySelector("[data-ticket-reply-line]")?.textContent).toBe(
      "Support replies within 2 business days.",
    );
    expect(c.textContent).toContain(
      "What did you expect, and what happened instead?",
    );
  });

  it("?type and ?target preselect; a foreign target falls back to Whole site", async () => {
    let c = await renderNew({ type: "question", target: "part:footer" });
    expect(
      c.querySelector<HTMLInputElement>('input[value="question"]')?.checked,
    ).toBe(true);
    expect(c.querySelector<HTMLSelectElement>("select")?.value).toBe(
      "part:footer",
    );
    mounted?.unmount();
    c = await renderNew({ type: "billing", target: "page:otherorgpage01" });
    expect(c.querySelector<HTMLSelectElement>("select")?.value).toBe(
      "site:site",
    );
  });

  it("?ref prefills the follow-up line; junk ref is ignored", async () => {
    let c = await renderNew({ ref: "1042", type: "change" });
    expect(c.querySelector<HTMLTextAreaElement>("#ticket-body")?.value).toBe(
      "Follows up on ticket #1042.\n\n",
    );
    mounted?.unmount();
    c = await renderNew({ ref: "<script>" });
    expect(c.querySelector<HTMLTextAreaElement>("#ticket-body")?.value).toBe(
      "",
    );
  });

  it("help deflection: 'change my hours' offers the hours article", async () => {
    const c = await renderNew();
    typeInto(c.querySelector("#ticket-subject"), "change my hours");
    await new Promise((r) => setTimeout(r, 300));
    await flush();
    expect(c.textContent).toContain("This might answer it");
    expect(c.textContent).toContain("Change your opening hours");
  });

  it("submit with nothing: TYPE-REQUIRED first, no action call", async () => {
    const c = await renderNew();
    submit(c.querySelector("form"));
    await flush();
    expect(c.textContent).toContain("Choose what you need.");
    expect(c.textContent).toContain("Add a short subject.");
    expect(c.textContent).toContain("Tell us a bit more so we can help.");
    expect(ticketActions.fileTicketAction).not.toHaveBeenCalled();
  });

  it("Send to Support files the ticket with from, no org, then opens it with a toast", async () => {
    const c = await renderNew({ from: "/hub/website?tab=pages" });
    click(c.querySelector('input[value="problem"]'));
    typeInto(c.querySelector("#ticket-subject"), "Contact form is broken");
    typeInto(c.querySelector("#ticket-body"), "It shows an error on send.");
    submit(c.querySelector("form"));
    await flush(10);
    expect(ticketActions.fileTicketAction).toHaveBeenCalledTimes(1);
    const input = ticketActions.fileTicketAction.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(input).toEqual({
      type: "problem",
      target: "site:site",
      subject: "Contact form is broken",
      body: "It shows an error on send.",
      uploadTokens: [],
      from: "/hub/website?tab=pages",
    });
    expect(Object.keys(input)).not.toContain("organization");
    expect(Object.keys(input)).not.toContain("orgId");
    expect(nav.push).toHaveBeenCalledWith("/hub/support/tickets/1042");
    expect(document.body.textContent).toContain(
      "Ticket #1042 sent. Support replies within 2 business days.",
    );
  });

  it("rate limit: RATE-TICKETS at the top, text kept", async () => {
    ticketActions.fileTicketAction.mockResolvedValue({
      ok: false,
      code: "rate_limited",
      message: "x",
    });
    const c = await renderNew();
    click(c.querySelector('input[value="question"]'));
    typeInto(c.querySelector("#ticket-subject"), "How do I add a page?");
    typeInto(c.querySelector("#ticket-body"), "Where is it?");
    submit(c.querySelector("form"));
    await flush(10);
    expect(c.querySelector("[data-ticket-alert]")?.textContent).toContain(
      "Your site has sent a lot of tickets today.",
    );
    expect(c.querySelector<HTMLInputElement>("#ticket-subject")?.value).toBe(
      "How do I add a page?",
    );
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("IN-C03: a file that didn't upload blocks Send until it is removed", async () => {
    // Every upload fails (network error), so the chip ends in the error state.
    class FailingXHR {
      upload = { onprogress: null, onload: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 0;
      responseText = "";
      open() {}
      setRequestHeader() {}
      send() {
        queueMicrotask(() => this.onerror?.());
      }
      abort() {
        this.onabort?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FailingXHR);
    try {
      const c = await renderNew();
      click(c.querySelector('input[value="problem"]'));
      typeInto(c.querySelector("#ticket-subject"), "Contact form is broken");
      typeInto(c.querySelector("#ticket-body"), "See the screenshot.");
      const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, "files", {
        value: [new File(["x"], "shot.png", { type: "image/png" })],
        configurable: true,
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await flush(10);
      submit(c.querySelector("form"));
      await flush(10);
      expect(ticketActions.fileTicketAction).not.toHaveBeenCalled();
      expect(c.textContent).toContain(
        "Remove or retry the file that didn't upload.",
      );
      expect(nav.push).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Discard with text asks first; Keep writing stays", async () => {
    const c = await renderNew({ from: "/hub/today" });
    typeInto(c.querySelector("#ticket-subject"), "Something");
    click(
      [...c.querySelectorAll("button")].find(
        (b) => b.textContent === "Discard",
      ),
    );
    await flush();
    expect(document.body.textContent).toContain("Leave without sending?");
    click(document.querySelector("[data-keep-writing]"));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("Discard with nothing typed goes straight back to ?from", async () => {
    const c = await renderNew({ from: "/hub/today" });
    click(
      [...c.querySelectorAll("button")].find(
        (b) => b.textContent === "Discard",
      ),
    );
    expect(nav.push).toHaveBeenCalledWith("/hub/today");
  });
});

const THREAD = "thrdaaaaaaaaaa1";

function ticket(status: string, over: Record<string, unknown> = {}) {
  return {
    id: THREAD,
    number: 1042,
    type: "problem",
    subject: "Contact form is broken",
    status,
    target: { kind: "site", id: "site", label: "Whole site" },
    openedByCds: false,
    paid: null,
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

function msg(id: string, kind: "member" | "staff" | "system", body: string) {
  return {
    id,
    authorKind: kind,
    authorName: kind === "member" ? "Maria" : "Mara",
    body,
    event: null,
    attachments: [],
    created: "2026-10-10T14:00:00.000Z",
  };
}

function update(status: string) {
  return {
    ok: true,
    data: {
      status,
      page: {
        messages: [msg("m1aaaaaaaaaaaa1", "member", "It shows an error.")],
        hasEarlier: false,
      },
    },
  };
}

async function renderTicket(number: string): Promise<HTMLElement> {
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

describe("/hub/support/tickets/<number> (COMM-07, COMM-09)", () => {
  beforeEach(() => {
    db.getTicketByNumber.mockResolvedValue(ticket("in_progress"));
    db.listThreadMessages.mockResolvedValue({
      messages: [msg("m1aaaaaaaaaaaa1", "member", "It shows an error.")],
      hasEarlier: false,
    });
    db.readSupportRead.mockResolvedValue({});
    for (const fn of Object.values(ticketActions)) {
      fn.mockResolvedValue({ ok: true, data: null });
    }
  });

  it("junk number is the hub 404 without a lookup", async () => {
    await expect(renderTicket("abc")).rejects.toThrow("NOT_FOUND");
    expect(db.getTicketByNumber).not.toHaveBeenCalled();
  });

  it("another site's number is the same hub 404", async () => {
    db.getTicketByNumber.mockRejectedValue(new NotFound("ticket not found"));
    await expect(renderTicket("1001")).rejects.toThrow("NOT_FOUND");
    expect(db.getTicketByNumber).toHaveBeenCalledWith(ROLES.owner, "1001");
  });

  it("shows subject, number line, rail, thread and Send reply; marks read", async () => {
    const c = await renderTicket("1042");
    expect(c.querySelector("h1")?.textContent).toBe("Contact form is broken");
    const line = c.querySelector("[data-ticket-line]")?.textContent ?? "";
    expect(line).toContain("#1042");
    expect(line).toContain("In progress");
    expect(line).toContain("Problem · Whole site");
    expect(c.querySelector("[data-ticket-meta]")).not.toBeNull();
    expect(c.textContent).toContain("It shows an error.");
    expect(buttonNamed(c, "Send reply")).toBeDefined();
    expect(c.textContent).toContain("Support replies within 2 business days.");
    expect(
      c.querySelector('a[href="/hub/support?tab=tickets"]')?.textContent,
    ).toContain("Tickets");
    expect(ticketActions.markTicketReadAction).toHaveBeenCalledWith(THREAD);
  });

  it("Waiting on you: the waiting line; a reply moves it to In progress", async () => {
    db.getTicketByNumber.mockResolvedValue(ticket("waiting_on_you"));
    ticketActions.replyTicketAction.mockResolvedValue(update("in_progress"));
    const c = await renderTicket("1042");
    expect(c.querySelector("[data-ticket-waiting]")?.textContent).toBe(
      "Support is waiting for your reply.",
    );
    typeInto(c.querySelector("[data-composer] textarea"), "Here is more.");
    click(buttonNamed(c, "Send reply"));
    await flush(10);
    expect(ticketActions.replyTicketAction).toHaveBeenCalledWith(
      1042,
      "Here is more.",
      [],
    );
    expect(c.querySelector("[data-ticket-line]")?.textContent).toContain(
      "In progress",
    );
    expect(c.querySelector("[data-ticket-waiting]")).toBeNull();
  });

  it("Resolved shows RESOLVED-NOTE above the composer", async () => {
    db.getTicketByNumber.mockResolvedValue(ticket("resolved"));
    const c = await renderTicket("1042");
    expect(c.querySelector("[data-ticket-resolved]")?.textContent).toContain(
      "If it isn't, reply and it reopens.",
    );
    expect(buttonNamed(c, "This is solved")).toBeUndefined();
  });

  it("Closed: CLOSED-NOTE, Open a new ticket prefilled, no composer", async () => {
    db.getTicketByNumber.mockResolvedValue(
      ticket("closed", {
        type: "change",
        target: { kind: "part", id: "footer", label: "Footer" },
      }),
    );
    const c = await renderTicket("1042");
    const panel = c.querySelector("[data-closed-ticket]");
    expect(panel?.textContent).toContain("This ticket is closed.");
    expect(panel?.querySelector("a")?.getAttribute("href")).toBe(
      "/hub/support/tickets/new?target=part%3Afooter&type=change&ref=1042",
    );
    expect(c.querySelector("[data-composer]")).toBeNull();
  });

  it("Viewer: no This is solved, VIEWER-READONLY instead of the composer", async () => {
    useRole("viewer");
    const c = await renderTicket("1042");
    expect(buttonNamed(c, "This is solved")).toBeUndefined();
    expect(c.querySelector("[data-composer] textarea")).toBeNull();
    expect(c.textContent).toContain("You can read support but not write.");
  });

  it("impersonating: no composer, no solved, nothing marked read", async () => {
    useRole("impersonating");
    const c = await renderTicket("1042");
    expect(buttonNamed(c, "This is solved")).toBeUndefined();
    expect(c.textContent).toContain("You're viewing as support staff");
    expect(ticketActions.markTicketReadAction).not.toHaveBeenCalled();
  });

  it("This is solved: Resolved, toast with Undo; Undo restores", async () => {
    ticketActions.markSolvedAction.mockResolvedValue(update("resolved"));
    ticketActions.undoSolvedAction.mockResolvedValue(update("in_progress"));
    const c = await renderTicket("1042");
    click(buttonNamed(c, "This is solved"));
    await flush(10);
    expect(ticketActions.markSolvedAction).toHaveBeenCalledWith(1042);
    expect(c.querySelector("[data-ticket-line]")?.textContent).toContain(
      "Resolved",
    );
    expect(document.body.textContent).toContain("Marked as solved.");
    click(buttonNamed(document.body, "Undo"));
    await flush(10);
    expect(ticketActions.undoSolvedAction).toHaveBeenCalledWith(1042);
    expect(c.querySelector("[data-ticket-line]")?.textContent).toContain(
      "In progress",
    );
  });

  it("WR-C02: solved with no refreshed state still shows the Undo toast and refreshes", async () => {
    ticketActions.markSolvedAction.mockResolvedValue({
      ok: true,
      data: { status: null, page: null },
    });
    const c = await renderTicket("1042");
    click(buttonNamed(c, "This is solved"));
    await flush(10);
    expect(document.body.textContent).toContain("Marked as solved.");
    expect(document.body.textContent).not.toContain("That didn't save.");
    expect(nav.refresh).toHaveBeenCalled();
  });
});

describe("IN-C07: ticket poll announces only rows not already shown", () => {
  beforeEach(() => {
    db.getTicketByNumber.mockResolvedValue(ticket("in_progress"));
    db.listThreadMessages.mockResolvedValue({
      messages: [
        msg("m1aaaaaaaaaaaa1", "member", "It shows an error."),
        msg("m2aaaaaaaaaaaa2", "staff", "Looking into it."),
      ],
      hasEarlier: false,
    });
    db.readSupportRead.mockResolvedValue({});
    for (const fn of Object.values(ticketActions)) {
      fn.mockResolvedValue({ ok: true, data: null });
    }
  });

  it("a re-delivered Support row is not announced again; a new one is", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [msg("m2aaaaaaaaaaaa2", "staff", "Looking into it.")],
        now: "2026-10-10T14:00:05.000Z",
        cursor: "2026-10-10T14:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const c = await renderTicket("1042");
      await vi.advanceTimersByTimeAsync(20_000);
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(c.textContent).not.toContain("new message from Support");
      expect(c.textContent?.split("Looking into it.").length).toBe(2);

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          messages: [
            msg("m2aaaaaaaaaaaa2", "staff", "Looking into it."),
            msg("m3aaaaaaaaaaaa3", "staff", "Fixed now."),
          ],
          now: "2026-10-10T14:00:10.000Z",
          cursor: "2026-10-10T14:00:00.000Z",
        }),
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await flush();
      expect(c.textContent).toContain("Fixed now.");
      expect(c.textContent).toContain("1 new message from Support");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("fileTicketAction (T-12-20-02)", () => {
  it("passes the request's User-Agent and fromUrl; never a client org", async () => {
    vi.resetModules();
    vi.doUnmock("../app/actions/support-tickets");
    vi.doMock("next/headers", () => ({
      headers: async () =>
        new Headers({
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36",
        }),
    }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("../lib/action", () => ({
      runAction: async (fn: (s: unknown) => Promise<unknown>) => ({
        ok: true,
        data: await fn({ ctx: ROLES.owner }),
      }),
    }));
    db.fileTicket.mockResolvedValue({ number: 1043, id: "thrdaaaaaaaaaa1" });
    const { fileTicketAction } = await import("../app/actions/support-tickets");
    const res = await fileTicketAction({
      type: "problem",
      subject: "Broken",
      body: "It broke.",
      target: "site:site",
      from: "/hub/today",
      userAgent: "spoofed",
      organization: "orgbbbbbbbbbbb2",
    });
    expect(res).toEqual({ ok: true, data: { number: 1043, type: "problem" } });
    const [ctx, input] = db.fileTicket.mock.calls[0]!;
    expect(ctx).toBe(ROLES.owner);
    expect(input.userAgent).toContain("Chrome/129.0");
    expect(input.userAgent).not.toBe("spoofed");
    expect(input.fromUrl).toBe("/hub/today");
    expect(input).not.toHaveProperty("organization");
    vi.doUnmock("next/headers");
    vi.doUnmock("next/cache");
    vi.doUnmock("../lib/action");
  });
});

describe("WR-C02: a write that landed is never reported as a failure", () => {
  async function realActions() {
    vi.resetModules();
    vi.doUnmock("../app/actions/support-tickets");
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("../lib/action", () => ({
      runAction: async (fn: (s: unknown) => Promise<unknown>) => {
        try {
          return { ok: true, data: await fn({ ctx: ROLES.owner }) };
        } catch {
          return { ok: false, code: "save_failed", message: "x" };
        }
      },
    }));
    return import("../app/actions/support-tickets");
  }
  afterEach(() => {
    vi.doUnmock("next/cache");
    vi.doUnmock("../lib/action");
  });

  it("reply, solve and undo return ok with no update when the refresh read fails", async () => {
    db.replyToTicket.mockResolvedValue(undefined);
    db.markTicketSolved.mockResolvedValue(undefined);
    db.undoMarkTicketSolved.mockResolvedValue(undefined);
    db.getTicketByNumber.mockRejectedValue(new Error("blip"));
    const a = await realActions();
    const empty = { ok: true, data: { status: null, page: null } };
    expect(await a.replyTicketAction(1042, "Thanks", [])).toEqual(empty);
    expect(db.replyToTicket).toHaveBeenCalledTimes(1);
    expect(db.markSupportRead).not.toHaveBeenCalled();
    expect(await a.markSolvedAction(1042)).toEqual(empty);
    expect(await a.undoSolvedAction(1042)).toEqual(empty);
  });

  it("a failed write is still a failure", async () => {
    db.replyToTicket.mockRejectedValue(new Error("down"));
    const a = await realActions();
    const res = await a.replyTicketAction(1042, "Thanks", []);
    expect(res.ok).toBe(false);
  });
});
