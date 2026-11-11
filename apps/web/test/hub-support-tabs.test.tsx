// @vitest-environment jsdom
// CDS Support Tickets, Documents and Ideas tabs (12-25; COMM-04, COMM-06, COMM-07, CUSTOM-01,
// SUPPORT-01; 12-UI-SPEC Tickets 355-372, Documents 503-521, Ideas 525-545). The real page
// over a mocked session, @cds/db and support actions:
//   - ?tab=tickets lists with Waiting on you first; the Open · Closed · All filter applies in
//     place; a Viewer's empty state has no Get help link; the Owner sees Your support (Care
//     row), an Admin does not;
//   - ?tab=documents never puts a signed link in the HTML; Download mints on click; opening
//     marks documents read (never while impersonating);
//   - ?tab=ideas ranks by votes, Viewers see counts but no vote buttons or Suggest a feature,
//     a vote calls toggleIdeaVoteAction, and a merged idea's old link shows the merged notice.
import { ToastRegion } from "@cds/ui/hub";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  usePathname: () => "/hub/support",
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
  admin: { orgId: "orgaaaaaaaaaaa1", actor: "u2", role: "admin", grants: [] },
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
  supportEmail: vi.fn(),
  getBusinessProfile: vi.fn(),
  getConversation: vi.fn(),
  listCdsNotes: vi.fn(),
  listThreadMessages: vi.fn(),
  readSupportRead: vi.fn(),
  carePlanUsage: vi.fn(),
  listTickets: vi.fn(),
  listCdsDocuments: vi.fn(),
  listThreadFiles: vi.fn(),
  listIdeas: vi.fn(),
  resolveMergedIdea: vi.fn(),
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

const lists = vi.hoisted(() => ({
  toggleIdeaVoteAction: vi.fn(),
  markDocumentsReadAction: vi.fn(),
  loadMoreDocumentsAction: vi.fn(),
}));
vi.mock("../app/actions/support-lists", () => lists);

const { default: SupportPage } =
  await import("../app/(platform)/hub/support/page");

function useRole(key: RoleKey) {
  sess.requireHubSession.mockResolvedValue({
    ctx: ROLES[key],
    email: "maria@riverabakery.com",
    org: { id: "orgaaaaaaaaaaa1", name: "Rivera Bakery", primaryHost: null },
    orgs: [],
    staleOrg: false,
  });
}

function ticket(
  number: number,
  status: string,
  subject: string,
  at: string,
  unread = false,
) {
  return {
    id: `thr${String(number).padStart(12, "0")}`,
    number,
    type: "problem",
    subject,
    status,
    target: { kind: "site", id: "site", label: "Whole site" },
    openedByCds: false,
    paid: null,
    incident: null,
    lastActivityAt: at,
    resolvedAt: null,
    closedAt: status === "closed" ? at : null,
    created: at,
    unread,
  };
}

const DOC = {
  id: "docaaaaaaaaaaa1",
  title: "Launch checklist",
  note: "Everything we checked before launch.",
  filename: "launch-checklist.pdf",
  size: 120_000,
  mime: "application/pdf",
  authorName: "Mara",
  created: "2026-10-09 15:00:00.000Z",
};

function file(
  id: string,
  kind: "member" | "staff",
  ticketNumber: number | null,
) {
  return {
    id,
    name: kind === "staff" ? "proof.png" : "menu.pdf",
    size: 2048,
    mime: kind === "staff" ? "image/png" : "application/pdf",
    scan: kind === "staff" ? "staff" : "clean",
    threadId: "thrdaaaaaaaaaa1",
    ticketNumber,
    authorKind: kind,
    created: "2026-10-08 12:00:00.000Z",
  };
}

function idea(id: string, title: string, votes: number, voted = false) {
  return {
    id,
    title,
    description: `${title} description`,
    status: "suggested",
    votes,
    voted,
    mine: false,
    created: "2026-10-01 10:00:00.000Z",
  };
}

let mounted: Mounted | null = null;
async function render(params: Record<string, string>): Promise<HTMLElement> {
  const el = (await SupportPage({
    searchParams: Promise.resolve(params),
  })) as ReactElement;
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  await flush();
  return mounted.container;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useRole("owner");
  db.supportEmail.mockReturnValue("help@cds.example");
  db.getBusinessProfile.mockResolvedValue({ time_zone: "America/Chicago" });
  db.carePlanUsage.mockResolvedValue({
    on: true,
    usedMinutes: 25,
    monthLabel: "October",
    resetLabel: "1 Nov",
  });
  db.listTickets.mockResolvedValue([
    ticket(
      1043,
      "waiting_on_you",
      "Menu photo is blurry",
      "2026-10-09T10:00:00Z",
      true,
    ),
    ticket(1044, "open", "Hours are wrong", "2026-10-10T10:00:00Z"),
    ticket(1040, "closed", "Old footer link", "2026-10-01T10:00:00Z"),
  ]);
  db.listCdsDocuments.mockResolvedValue([{ ...DOC, unread: true }]);
  db.listThreadFiles.mockResolvedValue([
    file("filaaaaaaaaaaa1", "staff", 1043),
    file("filaaaaaaaaaaa2", "member", null),
  ]);
  db.listIdeas.mockResolvedValue([
    idea("ideaaaaaaaaaaa1", "Gift cards", 12, true),
    idea("ideaaaaaaaaaaa2", "Waitlist", 4),
  ]);
  db.resolveMergedIdea.mockImplementation(async (_ctx, id: string) => id);
  for (const fn of [...Object.values(actions), ...Object.values(lists)]) {
    fn.mockResolvedValue({ ok: true, data: null });
  }
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function rows(c: HTMLElement): string[] {
  return [...c.querySelectorAll("[data-ticket-row]")].map((r) =>
    r.getAttribute("data-ticket-row")!,
  );
}

describe("Tickets tab (COMM-06, COMM-07, SUPPORT-01)", () => {
  it("lists open tickets with Waiting on you first; reads every ticket once", async () => {
    const c = await render({ tab: "tickets" });
    expect(c.querySelector("[data-tickets-panel]")).not.toBeNull();
    expect(c.textContent).toContain("Your tickets");
    expect(rows(c)).toEqual(["1043", "1044"]);
    expect(db.listTickets).toHaveBeenCalledWith(ROLES.owner, { show: "all" });
    expect(
      c.querySelector('[data-ticket-row="1043"]')?.getAttribute("href"),
    ).toBe("/hub/support/tickets/1043");
    expect(c.textContent).toContain("New reply");
  });

  it("?show=closed and ?show=all; the filter switches in place", async () => {
    let c = await render({ tab: "tickets", show: "closed" });
    expect(rows(c)).toEqual(["1040"]);
    mounted?.unmount();
    c = await render({ tab: "tickets", show: "all" });
    expect(rows(c)).toEqual(["1043", "1044", "1040"]);
    const closed = [...c.querySelectorAll('[role="radio"]')].find(
      (b) => b.textContent === "Closed",
    ) as HTMLElement;
    await click(closed);
    expect(rows(c)).toEqual(["1040"]);
  });

  it("empty: writers get TICKETS-EMPTY with Get help; a Viewer gets no link", async () => {
    db.listTickets.mockResolvedValue([]);
    useRole("editor");
    let c = await render({ tab: "tickets" });
    const link = [...c.querySelectorAll("[data-tickets-panel] a")].find(
      (a) => a.textContent === "Get help",
    );
    expect(c.textContent).toContain("No tickets");
    expect(link?.getAttribute("href")).toContain("/hub/support/tickets/new");
    mounted?.unmount();

    useRole("viewer");
    c = await render({ tab: "tickets" });
    expect(c.textContent).toContain("No tickets");
    const viewerLinks = [
      ...c.querySelectorAll("[data-tickets-panel] a"),
    ].filter((a) => a.textContent === "Get help");
    expect(viewerLinks).toHaveLength(0);
  });

  it("Owner sees Your support with the Care Plan row; Admin does not", async () => {
    let c = await render({ tab: "tickets" });
    const panel = c.querySelector("[data-your-support]")!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Included in your plan");
    expect(panel.textContent).toContain("What support includes");
    expect(panel.querySelector("[data-support-care]")?.textContent).toContain(
      "On · 25 of 60 minutes used in October",
    );
    mounted?.unmount();

    useRole("admin");
    c = await render({ tab: "tickets" });
    expect(c.querySelector("[data-your-support]")).toBeNull();
    expect(db.carePlanUsage).toHaveBeenCalledTimes(1);
  });

  it("Care Plan off: Not on your plan + About the Care Plan; a failed read drops the row", async () => {
    db.carePlanUsage.mockResolvedValue({ on: false, usedMinutes: 0 });
    let c = await render({ tab: "tickets" });
    const care = c.querySelector("[data-support-care]")!;
    expect(care.textContent).toContain("Not on your plan");
    expect(care.querySelector("a")?.getAttribute("href")).toBe(
      "/hub/help/care-plan",
    );
    mounted?.unmount();

    db.carePlanUsage.mockRejectedValue(new TypeError("down"));
    c = await render({ tab: "tickets" });
    expect(c.querySelector("[data-your-support]")).not.toBeNull();
    expect(c.querySelector("[data-support-care]")).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      "[hub] support care plan failed TypeError",
    );
  });

  it("a failed list shows ERR-SECTION", async () => {
    db.listTickets.mockRejectedValue(new Error("x"));
    const c = await render({ tab: "tickets" });
    expect(c.textContent).toContain("We couldn't load this part.");
  });
});

describe("Documents tab (COMM-04)", () => {
  it("lists documents and files; no signed link in the HTML; Download mints on click", async () => {
    const c = await render({ tab: "documents" });
    expect(c.querySelector("[data-documents-panel]")).not.toBeNull();
    expect(c.textContent).toContain("Launch checklist");
    expect(c.querySelector("[data-file]")).not.toBeNull();
    expect(c.innerHTML).not.toMatch(/sig=|exp=/);
    expect(db.listThreadFiles).toHaveBeenCalledWith(ROLES.owner, {
      from: "all",
      limit: 100,
    });

    actions.mintSupportFileLinkAction.mockResolvedValue({
      ok: true,
      data: "/hub/api/support/files/docaaaaaaaaaaa1?exp=1&sig=abc",
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const download = [...c.querySelectorAll("[data-doc] button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Download Launch checklist"),
    ) as HTMLElement;
    await click(download);
    await flush();
    expect(actions.mintSupportFileLinkAction).toHaveBeenCalledWith(
      "docaaaaaaaaaaa1",
    );
  });

  it("IN-C06: a rejected Download shows ERR-LOAD", async () => {
    const c = await render({ tab: "documents" });
    actions.mintSupportFileLinkAction.mockRejectedValue(new TypeError("net"));
    const download = [...c.querySelectorAll("[data-doc] button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Download Launch checklist"),
    ) as HTMLElement;
    await click(download);
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain(
      "We couldn't load this. Check your connection and try again.",
    );
  });

  it("opening marks documents read; never while impersonating", async () => {
    await render({ tab: "documents" });
    expect(lists.markDocumentsReadAction).toHaveBeenCalledTimes(1);
    mounted?.unmount();
    useRole("impersonating");
    await render({ tab: "documents" });
    expect(lists.markDocumentsReadAction).toHaveBeenCalledTimes(1);
  });

  it("?from=you filters to the member's files", async () => {
    const c = await render({ tab: "documents", from: "you" });
    const names = [...c.querySelectorAll("[data-file]")].map((r) =>
      r.getAttribute("data-file"),
    );
    expect(names).toEqual(["filaaaaaaaaaaa2"]);
  });

  it("a failed list shows ERR-SECTION", async () => {
    db.listCdsDocuments.mockRejectedValue(new Error("x"));
    const c = await render({ tab: "documents" });
    expect(c.textContent).toContain("We couldn't load this part.");
  });
});

function voteButtons(c: HTMLElement): HTMLElement[] {
  return [
    ...c.querySelectorAll<HTMLElement>("[data-idea] button[aria-pressed]"),
  ];
}

describe("Ideas tab (CUSTOM-01)", () => {
  it("writers: intro, ranked ideas, vote toggles and Suggest a feature", async () => {
    const c = await render({ tab: "ideas" });
    expect(c.querySelector("[data-ideas-panel]")).not.toBeNull();
    expect(c.textContent).toContain("One vote per site.");
    expect(db.listIdeas).toHaveBeenCalledWith(ROLES.owner, {
      status: "suggested",
    });
    const ids = [...c.querySelectorAll("[data-idea]")].map((r) =>
      r.getAttribute("data-idea"),
    );
    expect(ids).toEqual(["ideaaaaaaaaaaa1", "ideaaaaaaaaaaa2"]);
    expect(voteButtons(c)).toHaveLength(2);
    expect(
      c.querySelector("[data-suggest-feature]")?.getAttribute("href"),
    ).toBe("/hub/support/tickets/new?type=suggestion");

    lists.toggleIdeaVoteAction.mockResolvedValue({
      ok: true,
      data: { voted: true, votes: 5 },
    });
    click(voteButtons(c)[1]);
    await flush();
    expect(lists.toggleIdeaVoteAction).toHaveBeenCalledWith("ideaaaaaaaaaaa2");
    expect(voteButtons(c)[1]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("a failed vote reverts the count and shows ERR-VOTE", async () => {
    lists.toggleIdeaVoteAction.mockResolvedValue({
      ok: false,
      code: "save_failed",
      message: "nope",
    });
    const c = await render({ tab: "ideas" });
    click(voteButtons(c)[1]);
    await flush();
    expect(voteButtons(c)[1]?.getAttribute("aria-pressed")).toBe("false");
    expect(document.body.textContent).toContain("Your vote didn't save");
  });

  it.each(["viewer", "impersonating"] as const)(
    "%s: counts only, no vote buttons, no Suggest a feature",
    async (role) => {
      useRole(role);
      const c = await render({ tab: "ideas" });
      expect(voteButtons(c)).toHaveLength(0);
      expect(c.querySelector("[data-suggest-feature]")).toBeNull();
      expect(c.textContent).toContain("12 votes");
    },
  );

  it("?status=planned reads that status; the control switches by URL", async () => {
    db.listIdeas.mockResolvedValue([]);
    const c = await render({ tab: "ideas", status: "planned" });
    expect(db.listIdeas).toHaveBeenCalledWith(ROLES.owner, {
      status: "planned",
    });
    expect(c.textContent).toContain("Nothing planned right now.");
    const built = [...c.querySelectorAll('[role="radio"]')].find(
      (b) => b.textContent === "Built",
    );
    click(built);
    expect(nav.replace).toHaveBeenCalledWith(
      "/hub/support?tab=ideas&status=built",
      { scroll: false },
    );
  });

  it("a merged idea's old link lands on its target with the merged notice", async () => {
    db.resolveMergedIdea.mockResolvedValue("ideaaaaaaaaaaa1");
    db.listIdeas.mockImplementation(
      async (_ctx, { status }: { status: string }) =>
        status === "considering"
          ? [
              {
                ...idea("ideaaaaaaaaaaa1", "Gift cards", 12),
                status: "considering",
              },
            ]
          : [],
    );
    const c = await render({ tab: "ideas", idea: "ideaoldaaaaaaa9" });
    expect(db.resolveMergedIdea).toHaveBeenCalledWith(
      ROLES.owner,
      "ideaoldaaaaaaa9",
    );
    expect(c.textContent).toContain(
      "This idea was merged with a similar one. Your vote carried over.",
    );
    expect(
      c
        .querySelector('[data-idea="ideaaaaaaaaaaa1"]')
        ?.hasAttribute("data-highlight"),
    ).toBe(true);
    const checked = c.querySelector('[role="radio"][aria-checked="true"]');
    expect(checked?.textContent).toBe("Considering");
  });

  it("an unmerged ?idea= link shows no notice; junk ids are ignored", async () => {
    let c = await render({ tab: "ideas", idea: "ideaaaaaaaaaaa2" });
    expect(c.textContent).not.toContain("This idea was merged");
    mounted?.unmount();
    c = await render({ tab: "ideas", idea: "../x" });
    expect(db.resolveMergedIdea).toHaveBeenCalledTimes(1);
    expect(c.querySelector("[data-ideas-panel]")).not.toBeNull();
  });

  it("?new=<id> highlights the just-posted idea", async () => {
    const c = await render({ tab: "ideas", new: "ideaaaaaaaaaaa2" });
    expect(
      c
        .querySelector('[data-idea="ideaaaaaaaaaaa2"]')
        ?.hasAttribute("data-highlight"),
    ).toBe(true);
  });

  it("a failed list shows ERR-SECTION", async () => {
    db.listIdeas.mockRejectedValue(new Error("x"));
    const c = await render({ tab: "ideas" });
    expect(c.textContent).toContain("We couldn't load this part.");
  });
});
