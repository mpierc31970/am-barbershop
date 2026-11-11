// @vitest-environment jsdom
// 11-30 (DASH-06, DASH-08; UI-SPEC "Page delete and Recently deleted", "Destructive actions";
// D-UI-P11-20): the Pages row menu, DeletePageDialog (links, redirect picker, Keep page focus),
// the Page settings Delete section, the Undo toast and Recently deleted with Restore.
import { pagesFullCopy, pagesFullMemberCopy } from "@cds/core/content";
import { ToastRegion } from "@cds/ui/hub";
import type { ReactNode } from "react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  usePathname: () => "/hub/website",
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const actions = vi.hoisted(() => ({
  createPageAction: vi.fn(),
  updatePageAction: vi.fn(),
  pageDeleteCaseAction: vi.fn(),
  deletePageAction: vi.fn(),
  restoreDeletedPageAction: vi.fn(),
}));
vi.mock("../app/actions/pages", () => actions);
vi.mock("../app/actions/billing", () => ({
  packPreviewAction: vi.fn(),
  buyPackAction: vi.fn(),
}));
vi.mock("../app/actions/page-settings", () => ({
  openNotFoundPageAction: vi.fn(),
  savePageSettingsAction: vi.fn(),
}));

const { PagesTab } = await import("../app/(platform)/hub/website/PagesTab");
const { PAGE_DELETE_UI_COPY, linkLine } =
  await import("../app/(platform)/hub/website/DeletePageDialog");
const { RecentlyDeletedList, deletedLine } =
  await import("../app/(platform)/hub/website/RecentlyDeletedList");
const { PageSettingsDrawer } =
  await import("../app/(platform)/hub/website/pages/[pageId]/PageSettingsDrawer");

function page(over: Record<string, unknown>) {
  return {
    id: "p",
    slug: "x",
    title: "X",
    status: "published",
    published_at: "2026-09-12T14:14:00Z",
    has_unpublished_changes: false,
    kind: "builder",
    password_protected: false,
    seo: {},
    previous_slugs: [],
    ...over,
  } as never;
}

const PAGES = [
  page({ id: "p-home", slug: "home", title: "Home" }),
  page({ id: "p-about", slug: "about-us", title: "About us" }),
];

const OWNER = {
  role: "owner",
  impersonating: false,
  paused: false,
  unpriced: false,
  priceLabel: "$10/mo",
};

const CASE = {
  page: { id: "p-about", title: "About us", slug: "about-us" },
  deletable: true,
  links: [
    { where: "menu", label: "About us", place: "Menu" },
    { where: "footer", label: "About", place: "Footer" },
    { where: "button", label: "Learn more about us", place: "Home" },
  ],
  redirectOptions: [
    { id: "p-home", title: "Home" },
    { id: "p-faq", title: "FAQ" },
  ],
};

beforeAll(() => {
  // jsdom has no <dialog> modal API.
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

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function renderTab(
  props: Partial<Parameters<typeof PagesTab>[0]> = {},
): Mounted {
  m = mount(
    <ToastRegion>
      <PagesTab
        pages={PAGES}
        reserved={[]}
        canEdit
        usage={{ used: 2, allowance: 10 }}
        who={OWNER}
        {...props}
      />
    </ToastRegion>,
  );
  return m;
}

/** Open the (desktop table) row menu of a page and return its items' text. */
function openMenu(root: ParentNode, title: string): string[] {
  click(button(root, `More for ${title}`));
  const list = document.querySelector(`ul[aria-label="${title} actions"]`);
  if (!list) throw new Error(`no menu for ${title}`);
  return Array.from(list.querySelectorAll("a,button")).map(
    (el) => el.textContent?.trim() ?? "",
  );
}

/** The delete dialog (the Pages tab also holds the pack purchase <dialog>). */
function delDialog(): HTMLDialogElement | null {
  return (
    document.querySelector("[data-delete-page-dialog]")?.closest("dialog") ??
    null
  );
}

async function openDialog(): Promise<Mounted> {
  actions.pageDeleteCaseAction.mockResolvedValue({ ok: true, data: CASE });
  const r = renderTab();
  openMenu(r.container, "About us");
  click(button(document, "Delete page"));
  await flush();
  return r;
}

describe("Pages row menu (choice 1)", () => {
  it("Home has no Delete item; About has Open, Page settings, Delete page", () => {
    const r = renderTab();
    expect(openMenu(r.container, "Home")).toEqual(["Open", "Page settings"]);
    click(button(r.container, "More for Home"));
    expect(openMenu(r.container, "About us")).toEqual([
      "Open",
      "Page settings",
      "Delete page",
    ]);
  });

  it("Open and Page settings go to the builder", () => {
    const r = renderTab();
    openMenu(r.container, "About us");
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'ul[aria-label="About us actions"] a',
      ),
    ).map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "/hub/website/pages/p-about",
      "/hub/website/pages/p-about?settings=1",
    ]);
  });

  it("a Viewer sees Open only", () => {
    const r = renderTab({ canEdit: false });
    expect(openMenu(r.container, "About us")).toEqual(["Open"]);
  });

  it("Esc closes the menu and puts focus back on the trigger", () => {
    const r = renderTab();
    openMenu(r.container, "About us");
    const list = document.querySelector('ul[aria-label="About us actions"]')!;
    act(() => {
      list.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector('ul[aria-label="About us actions"]')).toBe(
      null,
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "More for About us",
    );
  });
});

describe("DeletePageDialog (choice 2)", () => {
  it("names the page, lists the links and focuses Keep page", async () => {
    await openDialog();
    expect(actions.pageDeleteCaseAction).toHaveBeenCalledWith("p-about");
    const dialog = delDialog()!;
    expect(dialog.textContent).toContain("Delete About us?");
    expect(dialog.textContent).toContain(PAGE_DELETE_UI_COPY.body);
    expect(dialog.textContent).toContain("Links to this page");
    expect(dialog.textContent).toContain("Menu: About us");
    expect(dialog.textContent).toContain("Footer: About");
    expect(dialog.textContent).toContain("Button on Home: Learn more about us");
    expect(dialog.textContent).toContain(PAGE_DELETE_UI_COPY.linksHidden);
    expect(document.activeElement?.textContent).toBe("Keep page");
  });

  it("the redirect picker defaults to Home and offers Nobody", async () => {
    await openDialog();
    const select = delDialog()!.querySelector("select") as HTMLSelectElement;
    const label = document.querySelector(`label[for="${select.id}"]`);
    expect(label?.textContent).toContain("Send visitors who open /about-us to");
    expect(select.value).toBe("p-home");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Home",
      "FAQ",
      "Nobody (show your page-not-found page)",
    ]);
    expect(delDialog()!.textContent).toContain(
      "Search engines learn the new address.",
    );
  });

  it("Delete page calls deletePageAction with the selected redirect", async () => {
    await openDialog();
    actions.deletePageAction.mockResolvedValue({
      ok: true,
      data: { id: "p-about", redirectTo: "faq" },
    });
    const select = delDialog()!.querySelector("select") as HTMLSelectElement;
    act(() => {
      select.value = "p-faq";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button(document, "Delete page"));
    await flush();
    expect(actions.deletePageAction).toHaveBeenCalledWith("p-about", "p-faq");
    expect(refresh).toHaveBeenCalled();
    expect(delDialog()).toBe(null);
  });

  it("Nobody sends null (the old address shows page not found)", async () => {
    await openDialog();
    actions.deletePageAction.mockResolvedValue({
      ok: true,
      data: { id: "p-about", redirectTo: null },
    });
    const select = delDialog()!.querySelector("select") as HTMLSelectElement;
    act(() => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button(document, "Delete page"));
    await flush();
    expect(actions.deletePageAction).toHaveBeenCalledWith("p-about", null);
  });

  it("a failed delete shows ERR-DELETE in the dialog and keeps it open", async () => {
    await openDialog();
    actions.deletePageAction.mockResolvedValue({
      ok: false,
      code: "save_failed",
      message: "Your changes weren't saved.",
    });
    click(button(document, "Delete page"));
    await flush();
    const dialog = delDialog()!;
    expect(dialog.textContent).toContain(PAGE_DELETE_UI_COPY.errDelete);
  });

  it("Keep page closes without deleting", async () => {
    await openDialog();
    click(button(document, "Keep page"));
    expect(delDialog()).toBe(null);
    expect(actions.deletePageAction).not.toHaveBeenCalled();
  });

  it("more than 5 links: the first 5, then 'and N more'", async () => {
    actions.pageDeleteCaseAction.mockResolvedValue({
      ok: true,
      data: {
        ...CASE,
        links: Array.from({ length: 8 }, (_, i) => ({
          where: "menu",
          label: `L${i}`,
          place: "Menu",
        })),
      },
    });
    const r = renderTab();
    openMenu(r.container, "About us");
    click(button(document, "Delete page"));
    await flush();
    const text = delDialog()!.textContent!;
    expect(text).toContain("Menu: L4");
    expect(text).not.toContain("Menu: L5");
    expect(text).toContain("and 3 more");
  });

  it("linkLine formats each kind", () => {
    expect(
      linkLine({ where: "menu", label: "About us", place: "Menu" } as never),
    ).toBe("Menu: About us");
    expect(
      linkLine({ where: "button", label: "Go", place: "Home" } as never),
    ).toBe("Button on Home: Go");
  });
});

describe("Page settings drawer Delete section", () => {
  function drawer(props: Record<string, unknown>) {
    m = mount(
      <ToastRegion>
        <PageSettingsDrawer
          open
          onClose={vi.fn()}
          pageId="p-about"
          passwordProtected={false}
          inMenu={false}
          navTopCount={0}
          onSaved={vi.fn()}
          {...props}
        />
      </ToastRegion>,
    );
    return m;
  }

  it("offers Delete this page and opens the dialog", async () => {
    actions.pageDeleteCaseAction.mockResolvedValue({ ok: true, data: CASE });
    drawer({ pageTitle: "About us", pageSlug: "about-us", canDelete: true });
    click(button(document, "Delete this page"));
    await flush();
    expect(document.body.textContent).toContain("Delete About us?");
  });

  it("after a delete the owner lands on the Pages tab", async () => {
    actions.pageDeleteCaseAction.mockResolvedValue({ ok: true, data: CASE });
    actions.deletePageAction.mockResolvedValue({
      ok: true,
      data: { id: "p-about", redirectTo: "home" },
    });
    drawer({ pageTitle: "About us", pageSlug: "about-us", canDelete: true });
    click(button(document, "Delete this page"));
    await flush();
    click(button(document, "Delete page"));
    await flush();
    expect(push).toHaveBeenCalledWith("/hub/website?tab=pages");
    expect(document.body.textContent).toContain("About us deleted.");
  });

  it("Home says it can't be deleted", () => {
    drawer({ pageTitle: "Home", pageSlug: "home", canDelete: true });
    expect(document.body.textContent).toContain(
      "Your home page can't be deleted.",
    );
    expect(button(document, "Delete this page")).toBe(null);
  });

  it("without content write there is no Delete section", () => {
    drawer({ pageTitle: "About us", pageSlug: "about-us", canDelete: false });
    expect(button(document, "Delete this page")).toBe(null);
  });
});

const BIN = [
  {
    id: "p-team",
    title: "Our team",
    slug: "our-team",
    deletedAt: "2026-10-09 10:00:00.000Z",
    deletedBy: "Maria",
  },
];

describe("Undo toast (choice 4)", () => {
  it("after delete the toast's Undo calls restore and refreshes", async () => {
    await openDialog();
    actions.deletePageAction.mockResolvedValue({
      ok: true,
      data: { id: "p-about", redirectTo: "home" },
    });
    actions.restoreDeletedPageAction.mockResolvedValue({
      ok: true,
      data: { id: "p-about", live: true },
    });
    click(button(document, "Delete page"));
    await flush();
    const status = document.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("About us deleted.");
    refresh.mockClear();
    click(button(status, "Undo"));
    await flush();
    expect(actions.restoreDeletedPageAction).toHaveBeenCalledWith("p-about");
    expect(status.textContent).toContain(
      "About us is back, with its menu and footer links.",
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("Undo refused at the allowance says PAGES-FULL", async () => {
    await openDialog();
    actions.deletePageAction.mockResolvedValue({
      ok: true,
      data: { id: "p-about", redirectTo: "home" },
    });
    actions.restoreDeletedPageAction.mockResolvedValue({
      ok: false,
      code: "page_limit",
      message: pagesFullCopy(10),
      allowance: 10,
    });
    click(button(document, "Delete page"));
    await flush();
    const status = document.querySelector('[role="status"]')!;
    click(button(status, "Undo"));
    await flush();
    expect(status.textContent).toContain(pagesFullCopy(10));
  });
});

describe("Recently deleted (choice 4)", () => {
  function bin(
    who: Record<string, unknown> = OWNER,
    deleted: unknown[] = BIN,
  ): Mounted {
    return renderTab({ deleted: deleted as never, who: who as never });
  }

  it("lists the page with its line and a named Restore", () => {
    const r = bin();
    const section = r.container.querySelector("[data-recently-deleted]")!;
    expect(section.tagName).toBe("DETAILS");
    expect(section.hasAttribute("open")).toBe(false);
    expect(section.querySelector("summary")?.textContent).toBe(
      "Recently deleted (1)",
    );
    expect(section.textContent).toContain("Our team");
    expect(section.textContent).toContain("/our-team");
    expect(section.textContent).toContain(
      "Deleted 9 Oct by Maria · Gone for good on 8 Nov",
    );
    expect(section.textContent).toContain(
      "Deleted pages are removed for good after 30 days.",
    );
    expect(button(section, "Restore Our team")).not.toBe(null);
  });

  it("an empty bin renders nothing", () => {
    const r = bin(OWNER, []);
    expect(r.container.querySelector("[data-recently-deleted]")).toBe(null);
    m?.unmount();
    m = mount(<RecentlyDeletedList pages={[]} />);
    expect(m.container.innerHTML).toBe("");
  });

  it("Restore brings the page back with a toast and a refresh", async () => {
    actions.restoreDeletedPageAction.mockResolvedValue({
      ok: true,
      data: { id: "p-team", live: true },
    });
    const r = bin();
    click(button(r.container, "Restore Our team"));
    await flush();
    expect(actions.restoreDeletedPageAction).toHaveBeenCalledWith("p-team");
    expect(document.querySelector('[role="status"]')!.textContent).toContain(
      "Our team is back, with its menu and footer links.",
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("Restore at the limit: Owner sees the D185 copy and Add 5 more pages", async () => {
    actions.restoreDeletedPageAction.mockResolvedValue({
      ok: false,
      code: "page_limit",
      message: pagesFullCopy(10),
      allowance: 10,
    });
    const r = bin();
    click(button(r.container, "Restore Our team"));
    await flush();
    const row = r.container.querySelector('[data-deleted-row="p-team"]')!;
    expect(row.textContent).toContain(pagesFullCopy(10));
    expect(button(row, "Add 5 more pages")).not.toBe(null);
  });

  it("Restore at the limit: an Editor gets PAGES-FULL-MEMBER, no link", async () => {
    actions.restoreDeletedPageAction.mockResolvedValue({
      ok: false,
      code: "page_limit",
      message: pagesFullCopy(15),
      allowance: 15,
    });
    const r = bin({ ...OWNER, role: "editor" });
    click(button(r.container, "Restore Our team"));
    await flush();
    const row = r.container.querySelector('[data-deleted-row="p-team"]')!;
    expect(row.textContent).toContain(pagesFullMemberCopy(15));
    expect(button(row, "Add 5 more pages")).toBe(null);
  });

  it("Restore with the address taken says RESTORE-SLUG-TAKEN", async () => {
    actions.restoreDeletedPageAction.mockResolvedValue({
      ok: false,
      code: "slug_taken",
      message: "x",
      field: "slug",
    });
    const r = bin();
    click(button(r.container, "Restore Our team"));
    await flush();
    expect(r.container.textContent).toContain(
      "Another page now uses /our-team. Change that page's address first, then restore this one.",
    );
  });

  it("any other failure says ERR-RESTORE", async () => {
    actions.restoreDeletedPageAction.mockResolvedValue({
      ok: false,
      code: "save_failed",
      message: "Your changes weren't saved.",
    });
    const r = bin();
    click(button(r.container, "Restore Our team"));
    await flush();
    expect(r.container.textContent).toContain(PAGE_DELETE_UI_COPY.errRestore);
  });

  it("deletedLine leaves out an unknown name", () => {
    expect(
      deletedLine({ deletedAt: "2026-10-09 10:00:00.000Z", deletedBy: "" }),
    ).toBe("Deleted 9 Oct · Gone for good on 8 Nov");
  });
});
