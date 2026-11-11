// @vitest-environment jsdom
// 07-32 Task 3: Page settings (action allowlist, drawer states) and the Pages list system row
// (CONT-28; D235 #11/#12, D-UI-P7-14; choices 9, 10, 13; T-07-32-06). The real session module
// and runAction run against mocked next/headers and @cds/db.
import { ToastRegion } from "@cds/ui/hub";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const state = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hub/website",
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.mock("../lib/content", () => ({ contentDeps: () => ({ deps: true }) }));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  getPage: vi.fn(),
  getNav: vi.fn(),
  setPagePassword: vi.fn(),
  addPageToNav: vi.fn(),
  removePageFromNav: vi.fn(),
  ensureNotFoundPage: vi.fn(),
}));
vi.mock("@cds/db", () => db);
// 11-28: actions/billing (via the Pages tab / Billing panel) loads the add-on registry.
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { get: () => undefined, list: () => [] },
}));

const { savePageSettingsAction, pickPageSettings, openNotFoundPageAction } =
  await import("../app/actions/page-settings");
const { PageSettingsDrawer, pageSettingsPayload, PAGE_SETTINGS_COPY } =
  await import("../app/(platform)/hub/website/pages/[pageId]/PageSettingsDrawer");
const { PagesTab, statusBadges } =
  await import("../app/(platform)/hub/website/PagesTab");

const ORG = { id: "org1", name: "Rivera Bakery", primaryHost: "rivera.com" };
const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };

function page(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    slug: "members",
    title: "Members",
    status: "published" as const,
    published_at: "2026-10-01T00:00:00.000Z",
    has_unpublished_changes: false,
    kind: "builder" as const,
    password_protected: false,
    seo: {},
    previous_slugs: [],
    ...over,
  };
}

function signIn() {
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@rivera.com",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
}

const NAV_WITH_P1 = {
  items: [
    {
      id: "n1",
      label: "Members",
      target: "page:p1",
      new_tab: false,
      children: [],
    },
  ],
  cta: null,
  held: false,
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

let m: Mounted | null = null;
beforeEach(() => {
  state.jar.clear();
  for (const fn of Object.values(db)) fn.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = "";
});

describe("savePageSettingsAction (T-07-32-06)", () => {
  it("copies only password and inMenu", async () => {
    expect(
      await pickPageSettings({
        password: "sourdough1",
        inMenu: true,
        organization: "evil",
        extra: 1,
      }),
    ).toEqual({ password: "sourdough1", inMenu: true });
    expect(await pickPageSettings({ password: 5, inMenu: "yes" })).toEqual({});
    expect(await pickPageSettings({ password: null })).toEqual({
      password: null,
    });
    expect(await pickPageSettings(null)).toEqual({});
  });

  it("sets the password only when present, and never returns it", async () => {
    signIn();
    db.setPagePassword.mockResolvedValue(page({ password_protected: true }));
    db.getNav.mockResolvedValue(null);
    const res = await savePageSettingsAction("p1", {
      password: "sourdough1",
      organization: "evil",
    } as never);
    expect(db.setPagePassword).toHaveBeenCalledWith(
      CTX,
      "p1",
      { password: "sourdough1" },
      { deps: true },
    );
    expect(res.ok).toBe(true);
    expect(JSON.stringify(res)).not.toContain("sourdough1");
    db.setPagePassword.mockClear();
    db.getPage.mockResolvedValue(page());
    await savePageSettingsAction("p1", { inMenu: false });
    expect(db.setPagePassword).not.toHaveBeenCalled();
  });

  it("unchecking removes the page from the menu; checking adds it", async () => {
    signIn();
    db.getPage.mockResolvedValue(page());
    db.getNav.mockResolvedValue(NAV_WITH_P1);
    db.removePageFromNav.mockResolvedValue({ removed: 1 });
    const off = await savePageSettingsAction("p1", { inMenu: false });
    expect(db.removePageFromNav).toHaveBeenCalledWith(
      CTX,
      { deps: true },
      "p1",
    );
    expect(off).toMatchObject({ ok: true, data: { inMenu: false } });

    db.getNav.mockResolvedValue(null);
    db.addPageToNav.mockResolvedValue({ added: true });
    const on = await savePageSettingsAction("p1", { inMenu: true });
    expect(db.addPageToNav).toHaveBeenCalledWith(CTX, { deps: true }, "p1");
    expect(on).toMatchObject({ ok: true, data: { inMenu: true } });
  });

  it("keeps the password when the menu change fails", async () => {
    signIn();
    db.setPagePassword.mockResolvedValue(page({ password_protected: true }));
    db.getNav.mockResolvedValue(NAV_WITH_P1);
    db.removePageFromNav.mockRejectedValue(new Error("pb down"));
    const res = await savePageSettingsAction("p1", {
      password: "sourdough1",
      inMenu: false,
    });
    expect(res).toMatchObject({
      ok: true,
      data: { inMenuError: true, page: { password_protected: true } },
    });
  });

  it("openNotFoundPageAction creates on first open, then opens the builder", async () => {
    signIn();
    db.ensureNotFoundPage.mockResolvedValue(
      page({ id: "nf1", kind: "system-404" }),
    );
    await expect(openNotFoundPageAction()).rejects.toThrow(
      "REDIRECT:/hub/website/pages/nf1",
    );
    expect(db.ensureNotFoundPage).toHaveBeenCalledWith(CTX);
  });
});

describe("pageSettingsPayload", () => {
  const off = { protected: false, inMenu: false };
  it("switch on + empty on an unprotected page is an error", () => {
    expect(
      pageSettingsPayload(off, {
        protected: true,
        password: "",
        inMenu: false,
      }),
    ).toEqual({ error: PAGE_SETTINGS_COPY.short });
    expect(
      pageSettingsPayload(off, {
        protected: true,
        password: "abc",
        inMenu: false,
      }),
    ).toEqual({ error: PAGE_SETTINGS_COPY.short });
  });
  it("empty on a protected page keeps the current password; off clears it", () => {
    const on = { protected: true, inMenu: true };
    expect(
      pageSettingsPayload(on, { protected: true, password: "", inMenu: true }),
    ).toEqual({ input: {} });
    expect(
      pageSettingsPayload(on, {
        protected: false,
        password: "",
        inMenu: false,
      }),
    ).toEqual({ input: { password: null, inMenu: false } });
  });
});

describe("PageSettingsDrawer", () => {
  function open(props: Partial<Parameters<typeof PageSettingsDrawer>[0]> = {}) {
    m = mount(
      <ToastRegion>
        <PageSettingsDrawer
          open
          onClose={vi.fn()}
          pageId="p1"
          passwordProtected={false}
          inMenu={false}
          navTopCount={2}
          onSaved={vi.fn()}
          {...props}
        />
      </ToastRegion>,
    );
    return m;
  }
  const save = () => button(document.body, PAGE_SETTINGS_COPY.save)!;
  const protect = () =>
    document.body.querySelector<HTMLInputElement>("#page-settings-protect")!;

  it("Save is disabled until dirty; switch on + empty shows the error", async () => {
    open();
    expect(save().disabled).toBe(true);
    click(protect());
    expect(save().disabled).toBe(false);
    expect(document.body.textContent).toContain(PAGE_SETTINGS_COPY.helper);
    click(save());
    await flush();
    expect(document.body.textContent).toContain(PAGE_SETTINGS_COPY.short);
    expect(db.setPagePassword).not.toHaveBeenCalled();
  });

  it("a protected page: empty field, keep placeholder, change helper after typing", () => {
    open({ passwordProtected: true });
    const field = document.body.querySelector<HTMLInputElement>(
      "#page-settings-password",
    )!;
    expect(field.value).toBe("");
    expect(field.placeholder).toBe(PAGE_SETTINGS_COPY.keepPlaceholder);
    expect(field.autocomplete).toBe("new-password");
    expect(document.body.textContent).not.toContain(
      PAGE_SETTINGS_COPY.changeHelper,
    );
    typeInto(field, "rye-bread-2");
    expect(document.body.textContent).toContain(
      PAGE_SETTINGS_COPY.changeHelper,
    );
    click(button(document.body, "Show"));
    expect(field.type).toBe("text");
  });

  it("the menu checkbox is disabled at the menu limit", () => {
    open({ navTopCount: 8 });
    const box = document.body.querySelector<HTMLInputElement>(
      "#page-settings-menu",
    )!;
    expect(box.disabled).toBe(true);
    expect(document.body.textContent).toContain("Menus hold up to 8 links.");
    expect(document.body.textContent).toContain(PAGE_SETTINGS_COPY.arrange);
  });
});

describe("Pages list system row (choices 9, 10)", () => {
  const home = page({ id: "h1", slug: "home", title: "Home" });
  const about = page({ id: "a1", slug: "about", title: "About" });
  const secret = page({
    id: "s1",
    slug: "secret",
    title: "Secret",
    password_protected: true,
  });

  function html(props: Partial<Parameters<typeof PagesTab>[0]> = {}) {
    return renderToStaticMarkup(
      <ToastRegion>
        <PagesTab pages={[about, home, secret]} reserved={[]} {...props} />
      </ToastRegion>,
    );
  }

  it("renders Page not found right after Home with the not-counted label", () => {
    const out = html({ canEdit: true });
    const table = out.slice(out.indexOf("<table"), out.indexOf("</table>"));
    const iHome = table.indexOf(">Home<");
    const iNf = table.indexOf("Page not found");
    const iAbout = table.indexOf(">About<");
    expect(iHome).toBeGreaterThan(-1);
    expect(iNf).toBeGreaterThan(iHome);
    expect(iAbout).toBeGreaterThan(iNf);
    expect(out).toContain("Doesn&#x27;t count");
    expect(out).toContain("System page");
    expect(out).toContain("—");
  });

  it("before creation the title is a form for editors, plain text otherwise", () => {
    expect(html({ canEdit: true })).toContain("data-not-found-open");
    const viewer = html({ canEdit: false });
    expect(viewer).not.toContain("data-not-found-open");
    expect(viewer).toContain("Page not found");
  });

  it("after creation the title links to the builder with its status", () => {
    const nf = page({
      id: "nf1",
      slug: "system-404",
      kind: "system-404",
      status: "draft",
      published_at: null,
    });
    const out = html({ notFoundPage: nf as never, canEdit: true });
    expect(out).toContain('href="/hub/website/pages/nf1"');
    expect(out).not.toContain("data-not-found-open");
  });

  it("protected pages get the Password badge", () => {
    expect(statusBadges(secret as never).map((b) => b.label)).toContain(
      "Password",
    );
    expect(statusBadges(about as never).map((b) => b.label)).not.toContain(
      "Password",
    );
  });

  it("10 builder pages plus the 404 row: the count is the server usage (11-28)", () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      page({ id: `p${i}`, slug: i === 0 ? "home" : `p${i}`, title: `P${i}` }),
    );
    const nf = page({ id: "nf1", slug: "system-404", kind: "system-404" });
    const out = renderToStaticMarkup(
      <ToastRegion>
        <PagesTab
          pages={ten as never}
          reserved={[]}
          notFoundPage={nf as never}
          canEdit
          usage={{ used: 10, allowance: 10 }}
        />
      </ToastRegion>,
    );
    expect(out).toContain("10 of 10");
  });
});
