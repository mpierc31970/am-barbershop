// @vitest-environment jsdom
// 07-19 Task 3: the Inbox page (CONT-25, D231, D271, D311, D-UI-P7-20; 07-UI-SPEC "Inbox";
// choices 7-12; T-07-19-08, T-07-19-09). The real server page runs over a mocked session and
// @cds/db; the inbox actions are mocked; the client panel renders in jsdom inside the hub
// ToastRegion.
import { NotFound } from "@cds/core";
import { ToastRegion } from "@cds/ui/hub";
import { readFileSync } from "node:fs";
import path from "node:path";
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
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/inbox",
  useRouter: () => ({
    push: vi.fn(),
    refresh: nav.refresh,
    replace: nav.replace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ROLES = {
  owner: { orgId: "org1", actor: "u1", role: "owner", grants: [] },
  editor: { orgId: "org1", actor: "u2", role: "editor", grants: [] },
  viewer: { orgId: "org1", actor: "u3", role: "viewer", grants: [] },
} as const;
const OWNER = ROLES.owner;

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  listSubmissions: vi.fn(),
  countSubmissions: vi.fn(),
  listForms: vi.fn(),
  getSubmission: vi.fn(),
  setSubmissionRead: vi.fn(),
  getBusinessProfile: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const actions = vi.hoisted(() => ({
  listMessagesAction: vi.fn(),
  openMessageAction: vi.fn(),
  setMessageReadAction: vi.fn(),
  markNotSpamAction: vi.fn(),
  deleteMessageAction: vi.fn(),
  exportMessagesAction: vi.fn(),
}));
vi.mock("../app/actions/inbox", () => actions);

const helpers = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../app/(platform)/hub/_intake/list-helpers", () => helpers);

const { default: InboxPage } = await import("../app/(platform)/hub/inbox/page");
const { default: InboxLoading } =
  await import("../app/(platform)/hub/inbox/loading");
const { INBOX_STEPS, INBOX_HOWTO } =
  await import("../app/(platform)/hub/inbox/inbox-steps");

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
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function msg(id: string, from: string, over: Record<string, unknown> = {}) {
  return {
    id,
    form: "f1",
    formName: "Contact",
    formDeleted: false,
    from,
    preview: "Do you do gluten-free cakes?",
    unread: false,
    spam: false,
    created: "2026-09-12T19:14:00Z",
    ...over,
  };
}

function detailOf(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    form: "f1",
    formName: "Contact",
    formDeleted: false,
    page: { id: "p1", title: "Home" },
    answers: [
      { label: "Name", value: "Maria Lopez" },
      { label: "Message", value: "Do you do gluten-free cakes?" },
    ],
    newsletter: true,
    email: "maria@example.com",
    contact: "c1",
    spam: false,
    readAt: null,
    created: "2026-09-12T19:14:00Z",
    ...over,
  };
}

function pageOf(items: unknown[], over: Record<string, unknown> = {}) {
  return {
    items,
    page: 1,
    perPage: 50,
    totalItems: items.length,
    totalPages: items.length > 0 ? 1 : 0,
    ...over,
  };
}

const ROWS = [
  msg("m1", "Maria Lopez", { unread: true }),
  msg("m2", "Ana Ruiz"),
  msg("m3", "sam@example.com"),
];
const FORMS = [
  { id: "f1", name: "Contact", deleted: false },
  { id: "f2", name: "Quote", deleted: true },
];

function as(role: keyof typeof ROLES) {
  sess.requireHubSession.mockResolvedValue({
    ctx: ROLES[role],
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset();
  helpers.download.mockReset();
  nav.replace.mockReset();
  nav.refresh.mockReset();
  as("owner");
  db.listSubmissions.mockResolvedValue(pageOf(ROWS));
  db.countSubmissions.mockResolvedValue({ unread: 1, filtered: 2 });
  db.listForms.mockResolvedValue(FORMS);
  db.getBusinessProfile.mockResolvedValue({ time_zone: "America/Chicago" });
  actions.openMessageAction.mockImplementation(async (id: string) => ({
    ok: true,
    data: { ...detailOf(id), readAt: "2026-09-12T20:00:00Z", read: true },
  }));
  actions.markNotSpamAction.mockResolvedValue({ ok: true, data: null });
  actions.deleteMessageAction.mockResolvedValue({ ok: true, data: null });
  actions.setMessageReadAction.mockResolvedValue({ ok: true, data: null });
});

async function render(sp: Record<string, string> = {}) {
  const el = await InboxPage({ searchParams: Promise.resolve(sp) });
  mounted = mount(<ToastRegion>{el as ReactElement}</ToastRegion>);
  await flush();
  return mounted.container;
}

/** The message drawer's title, or null (the training drawer is a dialog too). */
function messageDrawerTitle(): string | null {
  const h = Array.from(document.querySelectorAll("dialog h2")).find((x) =>
    x.textContent?.startsWith("Message"),
  );
  return h?.textContent ?? null;
}

function tabs(el: HTMLElement) {
  const nav = el.querySelector('nav[aria-label="Inbox sections"]')!;
  return Array.from(nav.querySelectorAll("a")).map((a) => ({
    label: a.textContent,
    href: a.getAttribute("href"),
    current: a.getAttribute("aria-current") === "page",
  }));
}

describe("Inbox page (07-19)", () => {
  it("owner: H1, Messages · Filtered · 2, toolbar and the table; reads 50 newest messages", async () => {
    const el = await render();
    expect(el.querySelector("h1")?.textContent).toBe("Inbox");
    expect(tabs(el)).toEqual([
      { label: "Messages", href: "/hub/inbox?tab=messages", current: true },
      {
        label: "Filtered · 2",
        href: "/hub/inbox?tab=filtered",
        current: false,
      },
    ]);
    expect(el.querySelector('form[role="search"]')).not.toBeNull();
    expect(button(el, "Export CSV")?.disabled).toBe(true);
    expect(el.querySelectorAll("tr[data-message-row]")).toHaveLength(3);
    expect(
      el.querySelector('tr[data-message-row="m1"]')?.textContent,
    ).toContain("Unread");
    expect(db.listSubmissions).toHaveBeenCalledWith(OWNER, {
      view: "messages",
      perPage: 50,
    });
    expect(db.listForms).toHaveBeenCalledWith(OWNER, { includeDeleted: true });
    expect(db.getSubmission).not.toHaveBeenCalled();
    expect(actions.openMessageAction).not.toHaveBeenCalled();
    // One primary per view: the list has none.
    expect(
      Array.from(el.querySelectorAll("button, a")).filter((b) =>
        b.className.includes("bg-hub-accent"),
      ),
    ).toHaveLength(0);
  });

  it("passes the parsed form and search; tab links keep them", async () => {
    const el = await render({ form: "f1", q: "cake", junk: "x" });
    expect(db.listSubmissions).toHaveBeenCalledWith(OWNER, {
      view: "messages",
      form: "f1",
      q: "cake",
      perPage: 50,
    });
    expect(tabs(el)[1]!.href).toBe("/hub/inbox?tab=filtered&form=f1&q=cake");
    expect(button(el, "Export CSV")?.disabled).toBe(false);
  });

  it("?tab=filtered (and the view=filtered alias) reads the Filtered view", async () => {
    let el = await render({ tab: "filtered" });
    expect(db.listSubmissions).toHaveBeenLastCalledWith(OWNER, {
      view: "filtered",
      perPage: 50,
    });
    expect(tabs(el)[1]!.current).toBe(true);
    mounted?.unmount();
    mounted = null;
    el = await render({ view: "filtered" });
    expect(db.listSubmissions).toHaveBeenLastCalledWith(OWNER, {
      view: "filtered",
      perPage: 50,
    });
    expect(tabs(el)[1]!.current).toBe(true);
  });

  it("no messages: EMPTY-INBOX with Go to Forms; no toolbar", async () => {
    db.listSubmissions.mockResolvedValue(pageOf([]));
    db.countSubmissions.mockResolvedValue({ unread: 0, filtered: 0 });
    const el = await render();
    expect(el.textContent).toContain("No messages yet");
    expect(el.textContent).toContain(
      "When someone sends a form on your site, it lands here and we email you a copy.",
    );
    const go = Array.from(el.querySelectorAll("a")).find(
      (a) => a.textContent === "Go to Forms",
    );
    expect(go?.getAttribute("href")).toBe("/hub/website?tab=forms");
    expect(el.querySelector('form[role="search"]')).toBeNull();
    expect(tabs(el)[1]!.label).toBe("Filtered");
  });

  it("Filtered empty: the Filtered empty line", async () => {
    db.listSubmissions.mockResolvedValue(pageOf([]));
    const el = await render({ tab: "filtered" });
    expect(el.textContent).toContain(
      "Nothing filtered. Messages that look like spam land here, so you can check them.",
    );
    expect(el.textContent).not.toContain("No messages yet");
  });

  it("filters with no match: No messages match and Clear filters", async () => {
    db.listSubmissions.mockResolvedValue(pageOf([]));
    const el = await render({ q: "zzz" });
    expect(el.textContent).toContain("No messages match.");
    click(button(el, "Clear filters"));
    await flush();
    expect(nav.replace).toHaveBeenCalledWith("/hub/inbox?tab=messages", {
      scroll: false,
    });
  });

  it("?message=<id> alone opens the drawer from the server read, then marks read once on the client", async () => {
    db.getSubmission.mockResolvedValue(detailOf("m9"));
    await render({ message: "m9" });
    expect(db.getSubmission).toHaveBeenCalledWith(OWNER, "m9");
    // The server render never marks read (choice 7).
    expect(db.setSubmissionRead).not.toHaveBeenCalled();
    const dlg = document.querySelector("dialog")!;
    expect(dlg.querySelector("h2")?.textContent).toBe(
      "Message from maria@example.com",
    );
    expect(
      Array.from(dlg.querySelectorAll("dl dt")).map((d) => d.textContent),
    ).toEqual(["Name", "Message"]);
    expect(actions.openMessageAction).toHaveBeenCalledTimes(1);
    expect(actions.openMessageAction).toHaveBeenCalledWith("m9");
    expect(nav.refresh).toHaveBeenCalled();
    expect(dlg.querySelector("[data-reply]")?.getAttribute("href")).toBe(
      "mailto:maria@example.com?subject=Re%3A%20your%20message%20to%20Rivera%20Bakery",
    );
  });

  it("a message that is gone shows the GONE alert over the list, no drawer", async () => {
    db.getSubmission.mockRejectedValue(new NotFound());
    const el = await render({ message: "gone1" });
    expect(el.textContent).toContain(
      "This was removed or moved. Reload the page to see the latest.",
    );
    expect(el.querySelectorAll("tr[data-message-row]")).toHaveLength(3);
    expect(messageDrawerTitle()).toBeNull();
    expect(actions.openMessageAction).not.toHaveBeenCalled();
  });

  it("a form that is gone lists without it and shows the GONE alert", async () => {
    db.listSubmissions
      .mockRejectedValueOnce(new NotFound())
      .mockResolvedValueOnce(pageOf(ROWS));
    const el = await render({ form: "zz9" });
    expect(db.listSubmissions).toHaveBeenLastCalledWith(OWNER, {
      view: "messages",
      perPage: 50,
    });
    expect(el.textContent).toContain("This was removed or moved.");
    expect(el.querySelectorAll("tr[data-message-row]")).toHaveLength(3);
  });

  it("ERR-LOAD when the list read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.listSubmissions.mockRejectedValue(new Error("pb down"));
    const el = await render();
    expect(el.textContent).toContain(
      "We couldn't load this. Check your connection and try again.",
    );
    expect(el.querySelector("h1")?.textContent).toBe("Inbox");
    spy.mockRestore();
  });

  it("clicking a sender opens the drawer at once, replaces the URL and marks read", async () => {
    const el = await render();
    click(el.querySelector('tr[data-message-row="m1"] button'));
    await flush();
    expect(nav.replace).toHaveBeenCalledWith(
      "/hub/inbox?tab=messages&message=m1",
      { scroll: false },
    );
    expect(document.querySelector("dialog h2")?.textContent).toBe(
      "Message from Maria Lopez",
    );
    expect(actions.openMessageAction).toHaveBeenCalledWith("m1");
    expect(
      el.querySelector('tr[data-message-row="m1"]')?.textContent,
    ).not.toContain("Unread");
    expect(nav.refresh).toHaveBeenCalled();
    expect(
      Array.from(document.querySelectorAll("dialog a"))
        .find((a) => a.textContent === "View contact")
        ?.getAttribute("href"),
    ).toBe("/hub/marketing?tab=contacts&contact=c1");
  });

  it("Load more appends the next 50 from listMessagesAction", async () => {
    db.listSubmissions.mockResolvedValue(
      pageOf(ROWS, { totalItems: 53, totalPages: 2 }),
    );
    actions.listMessagesAction.mockResolvedValue({
      ok: true,
      data: pageOf([msg("m4", "Lee")], {
        page: 2,
        totalItems: 53,
        totalPages: 2,
      }),
    });
    const el = await render({ form: "f1" });
    click(button(el, "Load more"));
    await flush();
    expect(actions.listMessagesAction).toHaveBeenCalledWith({
      view: "messages",
      form: "f1",
      page: 2,
    });
    expect(el.querySelectorAll("tr[data-message-row]")).toHaveLength(4);
    expect(button(el, "Load more")).toBeNull();
  });

  it("Not spam on a Filtered message: toast, row leaves, drawer closes, refresh", async () => {
    db.listSubmissions.mockResolvedValue(
      pageOf([msg("s1", "Bot", { spam: true })]),
    );
    actions.openMessageAction.mockResolvedValue({
      ok: true,
      data: { ...detailOf("s1", { spam: true }), read: true },
    });
    const el = await render({ tab: "filtered" });
    click(el.querySelector('tr[data-message-row="s1"] button'));
    await flush();
    expect(document.querySelector("[data-reply]")).toBeNull();
    click(button(document.body, "Not spam"));
    await flush();
    expect(actions.markNotSpamAction).toHaveBeenCalledWith("s1");
    expect(document.body.textContent).toContain("Moved to Messages.");
    expect(el.querySelector('tr[data-message-row="s1"]')).toBeNull();
    expect(messageDrawerTitle()).toBeNull();
  });

  it("Mark as unread and Delete message toast and close", async () => {
    const el = await render();
    click(el.querySelector('tr[data-message-row="m2"] button'));
    await flush();
    click(button(document.body, "More actions for message from Ana Ruiz"));
    click(button(document.body, "Mark as unread"));
    await flush();
    expect(actions.setMessageReadAction).toHaveBeenCalledWith("m2", false);
    expect(document.body.textContent).toContain("Marked as unread.");
    expect(
      el.querySelector('tr[data-message-row="m2"]')?.textContent,
    ).toContain("Unread");

    click(el.querySelector('tr[data-message-row="m3"] button'));
    await flush();
    click(
      button(document.body, "More actions for message from sam@example.com"),
    );
    click(button(document.body, "Delete message"));
    await flush();
    const confirm = Array.from(document.querySelectorAll("dialog")).find((d) =>
      d.textContent?.includes("Delete this message from sam@example.com?"),
    )!;
    click(
      Array.from(confirm.querySelectorAll("button")).find(
        (b) => b.textContent === "Delete message",
      ),
    );
    await flush();
    expect(actions.deleteMessageAction).toHaveBeenCalledWith("m3");
    expect(document.body.textContent).toContain("Message deleted.");
    expect(el.querySelector('tr[data-message-row="m3"]')).toBeNull();
  });

  it("Export CSV downloads the chosen form's messages", async () => {
    actions.exportMessagesAction.mockResolvedValue({
      ok: true,
      data: { filename: "contact-messages-2026-09-12.csv", csv: "a,b\n" },
    });
    const el = await render({ form: "f1" });
    click(button(el, "Export CSV"));
    await flush();
    expect(actions.exportMessagesAction).toHaveBeenCalledWith("f1");
    expect(helpers.download).toHaveBeenCalledWith({
      filename: "contact-messages-2026-09-12.csv",
      csv: "a,b\n",
    });
  });

  it("a deleted form's messages read 'Contact (deleted)'; the form list labels it", async () => {
    db.listSubmissions.mockResolvedValue(
      pageOf([msg("m1", "Maria Lopez", { formDeleted: true })]),
    );
    const el = await render();
    expect(el.querySelector("tr[data-message-row]")?.textContent).toContain(
      "Contact (deleted)",
    );
    expect(
      Array.from(el.querySelectorAll("select option")).map(
        (o) => o.textContent,
      ),
    ).toContain("Quote (deleted)");
  });

  it("viewer: no Delete and no Not spam; editor: no View contact", async () => {
    as("viewer");
    db.listSubmissions.mockResolvedValue(
      pageOf([msg("s1", "Bot", { spam: true })]),
    );
    actions.openMessageAction.mockResolvedValue({
      ok: true,
      data: { ...detailOf("s1", { spam: true }), read: true },
    });
    let el = await render({ tab: "filtered" });
    click(el.querySelector('tr[data-message-row="s1"] button'));
    await flush();
    expect(button(document.body, "Not spam")).toBeNull();
    click(button(document.body, "More actions for message from Bot"));
    expect(button(document.body, "Delete message")).toBeNull();
    expect(button(document.body, "Mark as unread")).not.toBeNull();
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";

    as("editor");
    db.listSubmissions.mockResolvedValue(pageOf(ROWS));
    actions.openMessageAction.mockImplementation(async (id: string) => ({
      ok: true,
      data: { ...detailOf(id), read: true },
    }));
    el = await render();
    click(el.querySelector('tr[data-message-row="m1"] button'));
    await flush();
    expect(document.querySelector("dialog h2")?.textContent).toBe(
      "Message from Maria Lopez",
    );
    expect(
      Array.from(document.querySelectorAll("dialog a")).some(
        (a) => a.textContent === "View contact",
      ),
    ).toBe(false);
  });

  it("a member without content read gets a 404 before any read", async () => {
    sess.requireHubSession.mockResolvedValue({
      ctx: { orgId: "org1", actor: "u9", role: "staff", grants: ["x"] },
      email: "s@b.c",
      org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
    });
    await expect(
      InboxPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(db.listSubmissions).not.toHaveBeenCalled();
  });

  it("loading state: the H1 and 5 skeleton rows", () => {
    mounted = mount(<InboxLoading />);
    expect(mounted.container.querySelector("h1")?.textContent).toBe("Inbox");
    expect(
      mounted.container.querySelectorAll("[data-skeleton-row]"),
    ).toHaveLength(5);
  });

  it("the baked how-to steps match docs/how-to/inbox.md (drift)", async () => {
    const gen =
      (await import("../../../packages/addon-registry/scripts/gen.mjs")) as {
        parseUseSteps: (md: string) => unknown[];
      };
    const md = readFileSync(
      path.resolve(import.meta.dirname, "../../..", INBOX_HOWTO),
      "utf8",
    );
    expect(gen.parseUseSteps(md)).toEqual(INBOX_STEPS.map((s) => ({ ...s })));
    expect(INBOX_STEPS.length).toBe(12);
  });

  it("the page replaced the 07-03 shell and never marks read during render", () => {
    const src = readFileSync(
      path.resolve(import.meta.dirname, "../app/(platform)/hub/inbox/page.tsx"),
      "utf8",
    );
    expect(src).not.toContain("SHELL_PANEL_BODY");
    expect(src).not.toMatch(/setSubmissionRead|openMessageAction/);
    expect(src.match(/listSubmissions\(/g)).toHaveLength(1);
  });
});
