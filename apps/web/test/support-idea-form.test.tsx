// @vitest-environment jsdom
// Suggest a feature inside Get help (12-27; CUSTOM-01, D297, D119; 12-UI-SPEC lines 386-389,
// 546-560, D-UI-P12-7). The real page over a mocked session, @cds/db and actions:
//   - Choosing Suggest a feature swaps the fields in place (H1 "Suggest a feature",
//     ?type=suggestion), keeps the type cards, and switching back keeps the ticket text.
//   - IDEA-PUBLIC is shown verbatim before Post idea (T-12-27-01).
//   - Typing "gift" offers the similar idea with an in-place vote ("Vote added to …").
//   - A Viewer cannot reach the form, even with ?type=suggestion.
//   - Post idea calls submitIdeaAction and lands on Ideas with ?new=<id>; a held idea gets
//     the review toast and no highlight; RATE-TICKETS on the rate limit (text kept).
//   - submitIdeaAction reads only title/description and maps submitIdea's result.
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
  viewer: { orgId: "orgaaaaaaaaaaa1", actor: "u4", role: "viewer", grants: [] },
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
  submitIdea: vi.fn(),
  toggleIdeaVote: vi.fn(),
}));
vi.mock("@cds/db", () => db);

vi.mock("../lib/help-index", () => ({ buildHelpIndex: () => [] }));

vi.mock("../app/actions/support-tickets", () => ({
  fileTicketAction: vi.fn(),
}));

const listActions = vi.hoisted(() => ({
  toggleIdeaVoteAction: vi.fn(),
}));
vi.mock("../app/actions/support-lists", () => listActions);

const ideaActions = vi.hoisted(() => ({
  submitIdeaAction: vi.fn(),
}));
vi.mock("../app/actions/ideas", () => ideaActions);

const { default: NewTicketPage, generateMetadata } =
  await import("../app/(platform)/hub/support/tickets/new/page");

const IDEA_PUBLIC =
  "Every CDS site can see this idea, without your business name.";

const TARGETS = [
  {
    label: "Your site",
    options: [{ kind: "site", id: "site", label: "Whole site" }],
  },
];

function idea(
  id: string,
  title: string,
  status: "suggested" | "considering" | "planned",
  votes = 3,
) {
  return {
    id,
    title,
    description: "",
    status,
    votes,
    voted: false,
    mine: false,
    created: "2026-10-01 10:00:00.000Z",
  };
}

const IDEAS = {
  suggested: [idea("ideaaaaaaaaaaa1", "Gift cards in the store", "suggested")],
  considering: [idea("ideaaaaaaaaaaa2", "Waitlist for events", "considering")],
  planned: [idea("ideaaaaaaaaaaa3", "Gift wrapping option", "planned", 9)],
};

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

async function settle(ms = 300): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useRole("owner");
  db.activeAddons.mockResolvedValue([]);
  db.getOrgStage.mockResolvedValue({ stage: "live" });
  db.getBusinessProfile.mockResolvedValue({ time_zone: "America/Chicago" });
  db.ticketTargets.mockResolvedValue(TARGETS);
  db.listIdeas.mockImplementation(
    async (_ctx: unknown, { status }: { status: keyof typeof IDEAS }) =>
      IDEAS[status] ?? [],
  );
  ideaActions.submitIdeaAction.mockResolvedValue({
    ok: true,
    data: { id: "ideaaaaaaaaaaa9", held: false },
  });
  listActions.toggleIdeaVoteAction.mockResolvedValue({
    ok: true,
    data: { voted: true, votes: 4 },
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("Suggest a feature in Get help (CUSTOM-01, D-UI-P12-7)", () => {
  it("choosing Suggest a feature swaps the form in place and sets ?type=suggestion", async () => {
    const c = await renderNew();
    expect(c.querySelector("h1")?.textContent).toBe("Get help");
    typeInto(c.querySelector("#ticket-subject"), "Menu is broken");

    click(c.querySelector('input[value="suggestion"]'));
    await flush();
    expect(c.querySelector("h1")?.textContent).toBe("Suggest a feature");
    expect(c.querySelector("[data-idea-form]")).not.toBeNull();
    expect(c.querySelector("#idea-title")).not.toBeNull();
    expect(c.querySelector("#idea-description")).not.toBeNull();
    expect(c.querySelector("#ticket-subject")).toBeNull();
    expect(c.textContent).toContain("Post idea");
    expect(c.textContent).toContain(
      "CDS may ask you about it in a ticket. Ideas don't have a reply time.",
    );
    // The type cards stay, with Suggest a feature checked.
    expect(
      c.querySelector<HTMLInputElement>('input[value="suggestion"]')?.checked,
    ).toBe(true);
    expect(nav.replace).toHaveBeenCalledWith(
      expect.stringContaining("type=suggestion"),
      { scroll: false },
    );

    // Switching back keeps the ticket text, and the idea text is kept too.
    typeInto(c.querySelector("#idea-title"), "Gift cards");
    click(c.querySelector('input[value="problem"]'));
    await flush();
    expect(c.querySelector("h1")?.textContent).toBe("Get help");
    expect(c.querySelector<HTMLInputElement>("#ticket-subject")?.value).toBe(
      "Menu is broken",
    );
    expect(nav.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("type=problem"),
      { scroll: false },
    );
    click(c.querySelector('input[value="suggestion"]'));
    await flush();
    expect(c.querySelector<HTMLInputElement>("#idea-title")?.value).toBe(
      "Gift cards",
    );
  });

  it("?type=suggestion opens the idea form directly; page title follows", async () => {
    const c = await renderNew({ type: "suggestion" });
    expect(c.querySelector("h1")?.textContent).toBe("Suggest a feature");
    expect(c.querySelector("[data-idea-form]")).not.toBeNull();
    expect(
      await generateMetadata({
        searchParams: Promise.resolve({ type: "suggestion" }),
      }),
    ).toEqual({ title: "Suggest a feature" });
    expect(
      await generateMetadata({ searchParams: Promise.resolve({}) }),
    ).toEqual({ title: "Get help" });
    // Similar-idea candidates: suggested, considering and planned (never built).
    expect(
      db.listIdeas.mock.calls.map((c) => (c[1] as { status: string }).status),
    ).toEqual(["suggested", "considering", "planned"]);
  });

  it("states IDEA-PUBLIC verbatim before Post idea (T-12-27-01)", async () => {
    const c = await renderNew({ type: "suggestion" });
    const notice = c.querySelector("[data-idea-public]");
    expect(notice?.textContent).toContain(IDEA_PUBLIC);
    const post = [...c.querySelectorAll("button")].find(
      (b) => b.textContent === "Post idea",
    );
    expect(post).toBeDefined();
    expect(
      notice!.compareDocumentPosition(post!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("typing 'gift' shows similar ideas with an in-place vote", async () => {
    const c = await renderNew({ type: "suggestion" });
    typeInto(c.querySelector("#idea-title"), "gi");
    await settle();
    expect(c.querySelector("[data-similar]")).toBeNull();

    typeInto(c.querySelector("#idea-title"), "gift");
    await settle();
    const rows = [...c.querySelectorAll("[data-similar]")];
    expect(rows.map((r) => r.getAttribute("data-similar"))).toEqual([
      "ideaaaaaaaaaaa1",
      "ideaaaaaaaaaaa3",
    ]);
    expect(c.textContent).toContain(
      "Already suggested? Vote for one of these instead.",
    );

    click(rows[0]!.querySelector("button[aria-pressed]"));
    await flush();
    expect(listActions.toggleIdeaVoteAction).toHaveBeenCalledWith(
      "ideaaaaaaaaaaa1",
    );
    expect(document.body.textContent).toContain(
      "Vote added to Gift cards in the store.",
    );
  });

  it("a failed ideas read leaves the form usable with no similar panel", async () => {
    db.listIdeas.mockRejectedValue(new Error("boom"));
    const c = await renderNew({ type: "suggestion" });
    typeInto(c.querySelector("#idea-title"), "gift");
    await settle();
    expect(c.querySelector("[data-idea-form]")).not.toBeNull();
    expect(c.querySelector("[data-similar]")).toBeNull();
  });

  it("a Viewer cannot reach the idea form", async () => {
    useRole("viewer");
    const c = await renderNew({ type: "suggestion" });
    expect(c.querySelector("form")).toBeNull();
    expect(c.querySelector("[data-idea-form]")).toBeNull();
    expect(db.listIdeas).not.toHaveBeenCalled();
  });
});

function postButton(c: HTMLElement): HTMLButtonElement {
  const b = [...c.querySelectorAll<HTMLButtonElement>("button")].find(
    (x) => x.textContent === "Post idea",
  );
  if (!b) throw new Error("no Post idea button");
  return b;
}

async function fillAndPost(c: HTMLElement): Promise<void> {
  typeInto(c.querySelector("#idea-title"), "Gift cards");
  typeInto(c.querySelector("#idea-description"), "Sell gift cards online.");
  submit(c.querySelector("form"));
  await flush();
}

describe("Post idea (CUSTOM-01)", () => {
  it("empty fields stay inline; nothing is posted", async () => {
    const c = await renderNew({ type: "suggestion" });
    expect(postButton(c).getAttribute("type")).toBe("submit");
    submit(c.querySelector("form"));
    await flush();
    expect(ideaActions.submitIdeaAction).not.toHaveBeenCalled();
    expect(c.textContent).toContain("Give your idea a short name.");
    expect(c.textContent).toContain("Describe your idea.");
    expect(document.activeElement?.id).toBe("idea-title");
  });

  it("posts, toasts and lands on Ideas with the new row highlighted", async () => {
    const c = await renderNew({ type: "suggestion" });
    await fillAndPost(c);
    expect(ideaActions.submitIdeaAction).toHaveBeenCalledWith({
      title: "Gift cards",
      description: "Sell gift cards online.",
    });
    expect(document.body.textContent).toContain(
      "Idea posted. Your site voted for it.",
    );
    expect(nav.push).toHaveBeenCalledWith(
      "/hub/support?tab=ideas&status=suggested&new=ideaaaaaaaaaaa9",
    );
  });

  it("a held idea says CDS will review it and highlights nothing (D-UI-P12-26)", async () => {
    ideaActions.submitIdeaAction.mockResolvedValue({
      ok: true,
      data: { id: "ideaaaaaaaaaaa9", held: true },
    });
    const c = await renderNew({ type: "suggestion" });
    await fillAndPost(c);
    expect(document.body.textContent).toContain(
      "Idea sent. CDS will review it before it's listed.",
    );
    expect(nav.push).toHaveBeenCalledWith(
      "/hub/support?tab=ideas&status=suggested",
    );
  });

  it("RATE-TICKETS on the rate limit; the text is kept", async () => {
    ideaActions.submitIdeaAction.mockResolvedValue({
      ok: false,
      code: "rate_limited",
      message: "x",
    });
    const c = await renderNew({ type: "suggestion" });
    await fillAndPost(c);
    expect(c.querySelector("[data-ticket-alert]")?.textContent).toContain(
      "Your site has sent a lot of tickets today.",
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(c.querySelector<HTMLInputElement>("#idea-title")?.value).toBe(
      "Gift cards",
    );
  });
});

describe("submitIdeaAction (T-12-27-02)", () => {
  it("passes only title and description; maps the result", async () => {
    vi.resetModules();
    vi.doUnmock("../app/actions/ideas");
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("../lib/action", () => ({
      runAction: async (fn: (s: unknown) => Promise<unknown>) => ({
        ok: true,
        data: await fn({ ctx: ROLES.owner }),
      }),
    }));
    db.submitIdea.mockResolvedValue({
      ideaId: "ideaaaaaaaaaaa9",
      number: 1050,
      held: false,
    });
    const { submitIdeaAction } = await import("../app/actions/ideas");
    const res = await submitIdeaAction({
      title: "Gift cards",
      description: "Sell gift cards online.",
      organization: "orgbbbbbbbbbbb2",
    });
    expect(res).toEqual({
      ok: true,
      data: { id: "ideaaaaaaaaaaa9", held: false },
    });
    const [ctx, input] = db.submitIdea.mock.calls[0]!;
    expect(ctx).toBe(ROLES.owner);
    expect(input).toEqual({
      title: "Gift cards",
      description: "Sell gift cards online.",
    });
    await expect(submitIdeaAction({ title: 42 })).rejects.toThrow();
    vi.doUnmock("next/cache");
    vi.doUnmock("../lib/action");
  });
});
