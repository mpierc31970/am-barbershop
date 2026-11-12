// @vitest-environment jsdom
// CDS Support (12-19; COMM-01, COMM-02, COMM-05, COMM-07, D83, D311; 12-UI-SPEC "Support
// frame", "Messages"). The real page over a mocked session, @cds/db and support actions:
//   - every member reads; Owner/Admin/Editor see Get help and the composer;
//   - a Viewer reads with VIEWER-READONLY and no composer or Get help;
//   - impersonating staff see IMPERSONATING-SUPPORT and no composer or Get help;
//   - an unknown ?tab= shows Messages (Tickets, Documents, Ideas: hub-support-tabs.test.tsx);
//   - the root carries data-cds-identity; the email fallback sits in the footer;
//   - notes, conversation, empty state, mark-read on open, send, and the 20 s poll.
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/support",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

const ROLES = {
  owner: { orgId: "orgaaaaaaaaaaa1", actor: "u1", role: "owner", grants: [] },
  admin: { orgId: "orgaaaaaaaaaaa1", actor: "u2", role: "admin", grants: [] },
  editor: { orgId: "orgaaaaaaaaaaa1", actor: "u3", role: "editor", grants: [] },
  viewer: { orgId: "orgaaaaaaaaaaa1", actor: "u4", role: "viewer", grants: [] },
  staffGrant: {
    orgId: "orgaaaaaaaaaaa1",
    actor: "u5",
    role: "staff",
    grants: ["studio-booking"],
  },
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
  supportEmail: vi.fn(),
  getBusinessProfile: vi.fn(),
  getConversation: vi.fn(),
  listCdsNotes: vi.fn(),
  listThreadMessages: vi.fn(),
  readSupportRead: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const actions = vi.hoisted(() => ({
  postConversationMessageAction: vi.fn(),
  loadEarlierMessagesAction: vi.fn(),
  markConversationReadAction: vi.fn(),
  markNotesReadAction: vi.fn(),
  mintSupportFileLinkAction: vi.fn(),
}));
vi.mock("../app/actions/support", () => actions);
vi.mock("../app/actions/support-lists", () => ({
  toggleIdeaVoteAction: vi.fn(),
  markDocumentsReadAction: vi.fn(),
  loadMoreDocumentsAction: vi.fn(),
}));

const { default: SupportPage } =
  await import("../app/(platform)/hub/support/page");

const THREAD = "thrdaaaaaaaaaa1";

function useRole(key: RoleKey) {
  sess.requireHubSession.mockResolvedValue({
    ctx: ROLES[key],
    email: "maria@riverabakery.com",
    org: { id: "orgaaaaaaaaaaa1", name: "Rivera Bakery", primaryHost: null },
    orgs: [],
    staleOrg: false,
  });
}

function msg(id: string, kind: "member" | "staff", body: string, at: string) {
  return {
    id,
    authorKind: kind,
    authorName: kind === "staff" ? "Mara" : "Maria",
    body,
    event: null,
    attachments: [],
    created: at,
  };
}

function note(id: string, title: string, pinned: boolean, unread = false) {
  return {
    id,
    title,
    body: `${title} body`,
    pinned,
    authorName: "Mara",
    created: "2026-10-09T15:00:00.000Z",
    updated: "2026-10-09T15:00:00.000Z",
    unread,
  };
}

let mounted: Mounted | null = null;
async function render(tab?: string): Promise<HTMLElement> {
  const el = (await SupportPage({
    searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
  })) as ReactElement;
  mounted = mount(el);
  await flush();
  return mounted.container;
}

const CDS = /Connections Design|\bCDS\b/;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useRole("owner");
  db.supportEmail.mockReturnValue("help@cds.example");
  db.getBusinessProfile.mockResolvedValue({ time_zone: "America/Chicago" });
  db.getConversation.mockResolvedValue({
    id: THREAD,
    lastActivityAt: "2026-10-10T15:00:00.000Z",
  });
  db.listThreadMessages.mockResolvedValue({
    messages: [
      msg(
        "m1aaaaaaaaaaaa1",
        "member",
        "Can you change the hours?",
        "2026-10-10T14:00:00.000Z",
      ),
      msg(
        "m2aaaaaaaaaaaa2",
        "staff",
        "Done, they are live.",
        "2026-10-10T15:00:00.000Z",
      ),
    ],
    hasEarlier: false,
  });
  db.readSupportRead.mockResolvedValue({
    [THREAD]: "2026-10-10T14:30:00.000Z",
  });
  db.listCdsNotes.mockResolvedValue({
    pinned: [note("n1aaaaaaaaaaaa1", "Your launch checklist", true, true)],
    earlier: [note("n2aaaaaaaaaaaa2", "September update", false)],
  });
  for (const fn of Object.values(actions)) {
    fn.mockResolvedValue({ ok: true, data: null });
  }
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("/hub/support frame (COMM-05, D311)", () => {
  it("Owner: Support identity root, mark, H1, byline link, Get help, four tabs", async () => {
    const c = await render();
    const root = c.querySelector("[data-cds-identity]")!;
    expect(root).not.toBeNull();
    expect(root.querySelector("h1")?.textContent).toBe("Support");
    expect(root.querySelector("[data-cds-mark]")).not.toBeNull();
    expect(c.textContent).toContain("From the support team");
    expect(
      c.querySelector("[data-support-includes]")?.getAttribute("href"),
    ).toBe("/hub/help/what-support-includes");
    const help = c.querySelector("[data-support-get-help]")!;
    expect(help.textContent).toBe("Get help");
    expect(help.getAttribute("href")).toBe(
      "/hub/support/tickets/new?from=%2Fhub%2Fsupport%3Ftab%3Dmessages",
    );
    expect(c.querySelector("[data-support-get-help-narrow]")).not.toBeNull();
    const tabs = [...c.querySelectorAll("nav a")].map((a) => a.textContent);
    expect(tabs).toEqual(["Messages", "Tickets", "Documents", "Ideas"]);
    expect(
      c.querySelector('nav a[aria-current="page"]')?.getAttribute("href"),
    ).toBe("/hub/support?tab=messages");
    // 12-33: the "?" opens the active tab's own article.
    expect(
      c.querySelector('a[href="/hub/help/support.messages"]'),
    ).not.toBeNull();
  });

  it("the email fallback sits in the footer, as a mailto with the business and site id", async () => {
    const c = await render();
    const footer = c.querySelector("footer[data-support-footer]")!;
    expect(footer.textContent).toBe(
      "Can't use your hub right now? Email help@cds.example.",
    );
    const email = footer.querySelector<HTMLAnchorElement>(
      "[data-support-email]",
    )!;
    const href = email.getAttribute("href")!;
    expect(href.startsWith("mailto:help@cds.example?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("subject")).toBe("Help with Rivera Bakery");
    expect(params.get("body")).toContain("orgaaaaaaaaaaa1");
  });

  it("no CDS_SUPPORT_EMAIL: the dev default address", async () => {
    db.supportEmail.mockReturnValue(null);
    const c = await render();
    expect(c.querySelector("[data-support-email]")?.textContent).toBe(
      "matthew@metaphysicalevents.com",
    );
  });

  it.each(["bogus", "", "Tickets"])(
    "?tab=%s (unknown) shows Messages",
    async (tab) => {
      const c = await render(tab);
      expect(
        c.querySelector("[data-support-tab]")?.getAttribute("data-support-tab"),
      ).toBe("messages");
      expect(c.querySelector("[data-messages-panel]")).not.toBeNull();
    },
  );

  it("every Support mention is inside [data-cds-identity] (D83)", async () => {
    const c = await render();
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (CDS.test(n.textContent ?? "")) {
        expect(n.parentElement?.closest("[data-cds-identity]")).not.toBeNull();
      }
    }
  });
});

describe("roles (COMM-07)", () => {
  it.each(["owner", "admin", "editor"] as const)(
    "%s sees Get help and the composer",
    async (role) => {
      useRole(role);
      const c = await render();
      expect(c.querySelector("[data-support-get-help]")).not.toBeNull();
      expect(c.querySelector("textarea")).not.toBeNull();
      expect(c.textContent).toContain("Write to Support");
      expect(c.textContent).not.toContain("You can read support but not write");
    },
  );

  it("Viewer reads, sees VIEWER-READONLY, no composer, no Get help", async () => {
    useRole("viewer");
    const c = await render();
    expect(c.textContent).toContain("Done, they are live.");
    expect(c.textContent).toContain(
      "You can read support but not write. Ask your site owner for Editor access.",
    );
    expect(c.querySelector("textarea")).toBeNull();
    expect(c.querySelector("[data-support-get-help]")).toBeNull();
    expect(c.querySelector("[data-support-get-help-narrow]")).toBeNull();
  });

  it("impersonating staff see IMPERSONATING-SUPPORT, no composer, nothing marked read", async () => {
    useRole("impersonating");
    const c = await render();
    expect(c.textContent).toContain(
      "You're viewing as support staff, so filing and replying are turned off here.",
    );
    expect(c.querySelector("textarea")).toBeNull();
    expect(c.querySelector("[data-support-get-help]")).toBeNull();
    expect(actions.markConversationReadAction).not.toHaveBeenCalled();
    expect(actions.markNotesReadAction).not.toHaveBeenCalled();
  });

  it("grants-only role: no support read, a notice and the footer, nothing loaded", async () => {
    useRole("staffGrant");
    const c = await render();
    expect(c.querySelector("[data-cds-identity]")).not.toBeNull();
    expect(c.textContent).toContain("doesn't include Support");
    expect(c.querySelector("[data-support-footer]")).not.toBeNull();
    expect(c.querySelectorAll("nav a").length).toBe(0);
    expect(db.listCdsNotes).not.toHaveBeenCalled();
    expect(db.getConversation).not.toHaveBeenCalled();
  });
});

describe("Messages tab (COMM-01, COMM-02)", () => {
  it("pinned note, earlier notes, conversation heading, thread and composer in order", async () => {
    const c = await render();
    const text = c.textContent ?? "";
    const order = [
      "Your launch checklist",
      "Earlier notes (1)",
      "Messages with us",
      "Can you change the hours?",
      "Done, they are live.",
      "Write to Support",
    ].map((t) => text.indexOf(t));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(c.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(c.querySelector("[data-unread-divider]")).not.toBeNull();
    expect(text).toContain("Support usually replies within 2 business days.");
    expect(db.listThreadMessages).toHaveBeenCalledWith(ROLES.owner, THREAD);
  });

  it("opening the tab marks unread notes and the conversation read", async () => {
    await render();
    expect(actions.markNotesReadAction).toHaveBeenCalledTimes(1);
    expect(actions.markConversationReadAction).toHaveBeenCalledWith(THREAD);
  });

  it("no conversation yet: MSG-EMPTY with the composer below, nothing polled", async () => {
    db.getConversation.mockResolvedValue(null);
    db.listCdsNotes.mockResolvedValue({ pinned: [], earlier: [] });
    const c = await render();
    expect(c.textContent).toContain("No messages yet");
    expect(c.textContent).toContain("Write to Support any time.");
    expect(c.querySelector("textarea")).not.toBeNull();
    expect(db.listThreadMessages).not.toHaveBeenCalled();
    expect(actions.markNotesReadAction).not.toHaveBeenCalled();
    expect(actions.markConversationReadAction).not.toHaveBeenCalled();
  });

  it("a failed conversation read shows ERR-LOAD with Try again", async () => {
    db.getConversation.mockRejectedValue(new Error("down"));
    const c = await render();
    expect(c.textContent).toContain(
      "We couldn't load this. Check your connection and try again.",
    );
    expect(
      [...c.querySelectorAll("a")].some(
        (a) =>
          a.textContent === "Try again" &&
          a.getAttribute("href") === "/hub/support?tab=messages",
      ),
    ).toBe(true);
    expect(c.querySelector("[data-support-footer]")).not.toBeNull();
  });

  it("a failed notes read keeps the conversation and shows ERR-SECTION", async () => {
    db.listCdsNotes.mockRejectedValue(new Error("down"));
    const c = await render();
    expect(c.textContent).toContain("We couldn't load this part.");
    expect(c.textContent).toContain("Done, they are live.");
  });

  it("Send message posts through the action and appends the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => null }),
    );
    actions.postConversationMessageAction.mockResolvedValue({
      ok: true,
      data: {
        threadId: THREAD,
        message: msg(
          "m3aaaaaaaaaaaa3",
          "member",
          "Thanks!",
          "2026-10-10T16:00:00.000Z",
        ),
      },
    });
    const c = await render();
    typeInto(c.querySelector("textarea"), "Thanks!");
    const send = [...c.querySelectorAll("button")].find(
      (b) => b.textContent === "Send message",
    );
    click(send);
    await flush();
    expect(actions.postConversationMessageAction).toHaveBeenCalledWith(
      "Thanks!",
      [],
    );
    expect(c.textContent).toContain("Thanks!");
  });

  it("WR-C01: a send polls at once from the server cursor, so a Support reply just before it is kept", async () => {
    const own = msg(
      "m3aaaaaaaaaaaa3",
      "member",
      "Thanks!",
      "2026-10-10T16:00:00.000Z",
    );
    actions.postConversationMessageAction.mockResolvedValue({
      ok: true,
      data: { threadId: THREAD, message: own },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          msg(
            "m5aaaaaaaaaaaa5",
            "staff",
            "Replied a moment ago.",
            "2026-10-10T15:59:00.000Z",
          ),
          own,
        ],
        now: "2026-10-10T16:00:01.000Z",
        cursor: "2026-10-10T16:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = await render();
    typeInto(c.querySelector("textarea"), "Thanks!");
    click(
      [...c.querySelectorAll("button")].find(
        (b) => b.textContent === "Send message",
      ),
    );
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const q = new URLSearchParams(
      String(fetchMock.mock.calls[0]![0]).split("?")[1],
    );
    // The cursor is the last server-read row, not the person's own post.
    expect(q.get("since")).toBe("2026-10-10T15:00:00.000Z");
    expect(c.textContent).toContain("Replied a moment ago.");
    expect(c.textContent?.split("Thanks!").length).toBe(2);
  });

  it("polls /hub/api/support every 20 s while visible and announces new Support messages", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          msg(
            "m4aaaaaaaaaaaa4",
            "staff",
            "One more thing.",
            "2026-10-10T17:00:00.000Z",
          ),
        ],
        now: "2026-10-10T17:00:05.000Z",
        cursor: "2026-10-10T17:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = await render();
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url.startsWith("/hub/api/support?")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("thread")).toBe(THREAD);
    expect(q.get("since")).toBe("2026-10-10T15:00:00.000Z");
    expect(c.textContent).toContain("One more thing.");
    expect(c.textContent).toContain("1 new message from Support");

    // A hidden page polls nothing.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      await vi.advanceTimersByTimeAsync(40_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
    }
  });
});
