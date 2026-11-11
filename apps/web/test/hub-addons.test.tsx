// @vitest-environment jsdom
// 05-11 Task 2: Get add-ons catalog, detail, add / add both / remove (ADDON-05, ADDON-07,
// ADDON-09, ADDON-11; 05-UI-SPEC "Catalog", "Detail", "Add and remove", R1). The RSC pages
// run against mocked next/headers and @cds/db, then mount in jsdom with the hub ToastRegion.
// The registry is the real add-ons plus the test-only fixtures (private, needs, conflicts).
import { composeAddonRegistry } from "@cds/core/addons";
import { ToastRegion } from "@cds/ui/hub";
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
  FIXTURE_CONFLICTS,
  FIXTURE_NEEDS,
  FIXTURE_PRIVATE,
  FIXTURE_QUOTE,
} from "../../../packages/core/src/addons/__fixtures__/manifests";
import { MANIFESTS } from "../../../packages/addon-registry/src/generated/manifests";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

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
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("NOT_FOUND"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
  usePathname: () => "/hub/add-ons",
  useRouter: () => ({ push: state.push, refresh: state.refresh }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  activeAddons: vi.fn(),
  listOrgAddons: vi.fn(),
  retainedRecordCounts: vi.fn(),
  listPages: vi.fn(),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  getBillingGate: vi.fn(() => ({ approve: vi.fn() })),
  getContentScanner: vi.fn(() => ({ scan: vi.fn() })),
  getSearchPinger: vi.fn(() => ({ ping: vi.fn() })),
  orgPlanPath: vi.fn(),
  readBillingAccount: vi.fn(),
  // WR-B04: a clean listing read where every public add-on is available (the manifest-only
  // outage fallback is never pickable).
  publicCatalogView: vi.fn(
    async (
      inputs: {
        slug: string;
        name: string;
        summary: string;
        visibility: string;
        path: string;
        premium?: boolean;
      }[],
    ) =>
      inputs
        .filter((i) => i.visibility === "public")
        .map((i) => ({
          slug: i.slug,
          name: i.name,
          tagline: i.summary,
          description: i.summary,
          screenshots: [],
          availability: "available",
          sort: 1000,
          pickable: true,
          private: false,
          path: i.path,
          premium: i.premium === true,
        })),
  ),
}));
vi.mock("@cds/db", () => db);

// 10-31: the cached catalog (BILL-18). Every add-on is $9/mo on Standard unless a test
// overrides a row.
const catalogRows = vi.hoisted(() => ({
  value: [] as {
    itemKind: string;
    itemKey: string;
    path: string;
    monthlyCents: number | null;
    oneTimeCents: number | null;
    installments: number | null;
  }[],
}));
vi.mock("../lib/catalog", () => ({
  getCatalog: async () => catalogRows.value,
}));
function priceRow(slug: string, monthlyCents: number | null) {
  return {
    itemKind: "addon",
    itemKey: slug,
    path: "standard",
    monthlyCents,
    oneTimeCents: null,
    installments: null,
  };
}
function setPrice(slug: string, monthlyCents: number | null) {
  catalogRows.value = [
    ...catalogRows.value.filter((r) => r.itemKey !== slug),
    priceRow(slug, monthlyCents),
  ];
}

const actions = vi.hoisted(() => ({
  addAddonAction: vi.fn(),
  addBothAction: vi.fn(),
  removeAddonAction: vi.fn(),
  updateCardAction: vi.fn(),
  addAddonPreviewAction: vi.fn(),
}));
vi.mock("../app/actions/addons", () => actions);

const registry = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@cds/addon-registry/server", () => ({
  get ADDON_REGISTRY() {
    return registry.value;
  },
  ADDON_SERVER: {},
}));
vi.mock("@cds/addon-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cds/addon-registry")>();
  return {
    ...actual,
    get ADDON_REGISTRY() {
      return registry.value;
    },
  };
});
registry.value = composeAddonRegistry(
  [
    ...MANIFESTS,
    FIXTURE_QUOTE,
    FIXTURE_PRIVATE,
    FIXTURE_NEEDS,
    FIXTURE_CONFLICTS,
  ],
  { fileExists: () => true },
);

const { default: CatalogPage } =
  await import("../app/(platform)/hub/add-ons/page");
const { default: DetailPage } =
  await import("../app/(platform)/hub/add-ons/[slug]/page");
const { default: AddonsLoading } =
  await import("../app/(platform)/hub/add-ons/loading");

beforeAll(() => {
  // jsdom has <dialog> but not the modal API; open/close by attribute is enough here.
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

type Ctx = {
  orgId: string;
  actor: string;
  role: string;
  grants: string[];
  impersonator?: string;
};
const OWNER: Ctx = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const ORG = { id: "org1", name: "Palm", primaryHost: "palm.example" };

let mounted: Mounted | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  state.jar.clear();
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [ORG],
  });
  signInAs(OWNER);
  db.activeAddons.mockResolvedValue([]);
  db.listOrgAddons.mockResolvedValue([]);
  db.retainedRecordCounts.mockResolvedValue(0);
  db.orgPlanPath.mockResolvedValue("standard");
  db.readBillingAccount.mockResolvedValue({ paidAt: null });
  actions.addAddonPreviewAction.mockResolvedValue({
    ok: true,
    preview: {
      kind: "joins",
      note: "It joins your order: $9/mo from checkout, no setup fee.",
    },
    token: "tok-x",
  });
  catalogRows.value = (registry.value as { list: () => { slug: string }[] })
    .list()
    .map((m) => priceRow(m.slug, 900));
  db.listPages.mockResolvedValue([
    { id: "p9", slug: "testimonials", title: "Testimonials" },
  ]);
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function signInAs(ctx: Ctx) {
  db.orgContextFromToken.mockResolvedValue(ctx);
}

async function show(el: Promise<ReactElement | never>): Promise<HTMLElement> {
  const ui = await el;
  mounted = mount(<ToastRegion>{ui}</ToastRegion>);
  return mounted.container;
}

const catalog = () => show(CatalogPage() as Promise<ReactElement>);
const detail = (slug: string) =>
  show(
    DetailPage({ params: Promise.resolve({ slug }) }) as Promise<ReactElement>,
  );

function cardNames(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("article h2")).map(
    (h) => h.textContent ?? "",
  );
}

function openDialog(): HTMLDialogElement | null {
  return document.querySelector("dialog[open]");
}

describe("catalog /hub/add-ons (ADDON-09, D311)", () => {
  it("lists public add-ons in manifest order with On your site on the added one", async () => {
    db.activeAddons.mockResolvedValue(["testimonials"]);
    const el = await catalog();
    expect(el.querySelector("h1")?.textContent).toBe("Get add-ons");
    expect(el.textContent).toContain(
      "Add features to your site. Each one adds its own tab here and blocks you can place on any page.",
    );
    expect(cardNames(el)).toEqual([
      "Testimonials",
      "Credentials",
      "Builder Pro",
      "Fixture quote",
      "Fixture fixture-needs",
      "Fixture fixture-conflicts",
    ]);
    expect(el.textContent).not.toContain("fixture-private");
    const first = el.querySelectorAll("article")[0]!;
    expect(first.textContent).toContain("On your site");
    expect(first.textContent).toContain(
      "Reviews · Adds a page, a block and a tab",
    );
    expect(
      first
        .querySelector('a[aria-label="Manage Testimonials"]')
        ?.getAttribute("href"),
    ).toBe("/hub/website?tab=testimonials");
    const second = el.querySelectorAll("article")[1]!;
    expect(second.textContent).not.toContain("On your site");
    expect(button(second, "Add to site")).not.toBeNull();
  });

  it("Admin sees Details only", async () => {
    signInAs({ ...OWNER, role: "admin" });
    const el = await catalog();
    expect(button(el, "Add to site")).toBeNull();
    expect(el.querySelector('a[aria-label^="Manage"]')).toBeNull();
    expect(
      el
        .querySelector('a[aria-label="Testimonials details"]')
        ?.getAttribute("href"),
    ).toBe("/hub/add-ons/testimonials");
  });

  it("is a 404 for an editor", async () => {
    signInAs({ ...OWNER, role: "editor" });
    await expect(CatalogPage()).rejects.toThrow("NOT_FOUND");
  });

  it("shows ERR-LOAD with Try again when the add-on state can't be read", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.activeAddons.mockRejectedValue(new Error("down"));
    const el = await catalog();
    err.mockRestore();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      "We couldn't load this.",
    );
    expect(el.querySelector('a[href="/hub/add-ons"]')?.textContent).toBe(
      "Try again",
    );
  });

  it("card Add to site opens the confirm, adds, lands on the tab with a toast", async () => {
    actions.addAddonAction.mockResolvedValue({
      ok: true,
      data: {
        slug: "credentials",
        outcome: "installed",
        tabHref: "/hub/website?tab=credentials",
        pageUrl: "https://palm.example/credentials",
      },
    });
    const el = await catalog();
    click(button(el.querySelectorAll("article")[1]!, "Add to site"));
    await flush();
    const dialog = openDialog()!;
    expect(dialog.textContent).toContain("Add Credentials to your site?");
    expect(dialog.textContent).toContain(
      "It adds a Credentials page and a Credentials block you can place on any page.",
    );
    expect(document.activeElement).toBe(button(dialog, "Add to site"));
    click(button(dialog, "Add to site"));
    await flush();
    expect(actions.addAddonAction).toHaveBeenCalledWith("credentials", "tok-x");
    expect(state.push).toHaveBeenCalledWith("/hub/website?tab=credentials");
    // C-WR-05: the shared /hub layout (sidebar) re-renders after the navigation.
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(state.refresh.mock.invocationCallOrder[0]).toBeGreaterThan(
      state.push.mock.invocationCallOrder[0]!,
    );
    expect(document.body.textContent).toContain("Credentials is on your site.");
    expect(button(document.body, "View on site")).not.toBeNull();
    expect(openDialog()).toBeNull();
  });

  it("keeps the dialog open with ERR-ADD when adding fails", async () => {
    actions.addAddonAction.mockResolvedValue({
      ok: false,
      code: "save_failed",
      message: "generic",
    });
    const el = await catalog();
    click(button(el.querySelectorAll("article")[0]!, "Add to site"));
    await flush();
    click(button(openDialog()!, "Add to site"));
    await flush();
    expect(openDialog()?.textContent).toContain(
      "Testimonials wasn't added, and nothing changed on your site. Try again in a minute.",
    );
    expect(state.push).not.toHaveBeenCalled();
  });

  it("a rejected add request unlocks the dialog with ERR-ADD (C-WR-01)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    actions.addAddonAction.mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await catalog();
    click(button(el.querySelectorAll("article")[0]!, "Add to site"));
    await flush();
    click(button(openDialog()!, "Add to site"));
    await flush();
    err.mockRestore();
    const dialog = openDialog()!;
    expect(dialog.textContent).toContain(
      "Testimonials wasn't added, and nothing changed on your site. Try again in a minute.",
    );
    // Not stuck in "Adding…": both buttons work again and Not now closes the dialog.
    expect(button(dialog, "Add to site")!.disabled).toBe(false);
    click(button(dialog, "Not now"));
    expect(openDialog()).toBeNull();
    expect(state.push).not.toHaveBeenCalled();
  });

  it("the re-add line counts the kept items", async () => {
    db.listOrgAddons.mockResolvedValue([
      { addon: "testimonials", status: "disabled", seeded: {} },
    ]);
    db.retainedRecordCounts.mockResolvedValue(12);
    const el = await catalog();
    click(button(el.querySelectorAll("article")[0]!, "Add to site"));
    await flush();
    expect(openDialog()?.textContent).toContain(
      "Your 12 testimonials come back as they were.",
    );
  });

  it("loading shows 3 skeleton cards", () => {
    mounted = mount(<AddonsLoading />);
    expect(
      mounted.container.querySelectorAll("[data-skeleton-card]").length,
    ).toBe(3);
  });
});

describe("detail /hub/add-ons/[slug]", () => {
  it("renders What it adds, the first 3 steps and Add to site", async () => {
    const el = await detail("testimonials");
    expect(el.querySelector("h1")?.textContent).toBe("Testimonials");
    expect(el.textContent).toContain("A Testimonials page at /testimonials");
    expect(el.textContent).toContain(
      "A Testimonials block you can place on any page",
    );
    expect(el.textContent).toContain("A Testimonials tab under Website");
    const how = el.querySelector('section[aria-labelledby="how-heading"]')!;
    expect(how.textContent).toContain("How Testimonials works");
    expect(how.querySelector("ol")!.querySelectorAll("li").length).toBe(3);
    expect(button(how, "Read all steps")).not.toBeNull();
    expect(
      el.querySelector('section[aria-labelledby="works-heading"]'),
    ).toBeNull();
    expect(el.textContent).not.toContain("Remove from site");
    const add = button(el, "Add to site")!;
    expect(add.disabled).toBe(false);
  });

  it("is a 404 for a private or unknown slug, the same way", async () => {
    await expect(
      DetailPage({ params: Promise.resolve({ slug: "fixture-private" }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      DetailPage({ params: Promise.resolve({ slug: "nope" }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      DetailPage({ params: Promise.resolve({ slug: "__proto__" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("a missing requirement shows the info alert and an Add both dialog", async () => {
    actions.addBothAction.mockResolvedValue({
      ok: true,
      data: {
        added: ["fixture-quote", "fixture-needs"],
        tabHref: "/hub/website?tab=fixture-needs",
        pageUrl: null,
      },
    });
    const el = await detail("fixture-needs");
    expect(el.textContent).toContain(
      "Fixture fixture-needs needs Fixture quote. Add both to your site? Fixture quote goes on first.",
    );
    const works = el.querySelector('section[aria-labelledby="works-heading"]')!;
    expect(works.textContent).toContain("Needs: Fixture quote");
    expect(works.querySelector("a")?.getAttribute("href")).toBe(
      "/hub/add-ons/fixture-quote",
    );
    click(button(el, "Add to site"));
    await flush();
    const dialog = openDialog()!;
    expect(dialog.textContent).toContain(
      "Fixture fixture-needs needs Fixture quote",
    );
    expect(dialog.textContent).toContain(
      "Add both to your site? Fixture quote goes on first, then Fixture fixture-needs.",
    );
    click(button(dialog, "Add both"));
    await flush();
    expect(actions.addBothAction).toHaveBeenCalledWith("fixture-needs", {
      "fixture-quote": "tok-x",
      "fixture-needs": "tok-x",
    });
    expect(document.body.textContent).toContain(
      "Fixture quote and Fixture fixture-needs are on your site.",
    );
  });

  it("Add both failing part way says what went on and refreshes (C-WR-02)", async () => {
    actions.addBothAction.mockResolvedValue({
      ok: false,
      code: "save_failed",
      message: "generic",
      added: [{ slug: "fixture-quote", name: "Fixture quote" }],
    });
    actions.addAddonAction.mockResolvedValue({
      ok: true,
      data: {
        slug: "fixture-needs",
        outcome: "installed",
        tabHref: "/hub/website?tab=fixture-needs",
        pageUrl: null,
      },
    });
    const el = await detail("fixture-needs");
    click(button(el, "Add to site"));
    await flush();
    click(button(openDialog()!, "Add both"));
    await flush();
    const dialog = openDialog()!;
    expect(dialog.textContent).toContain(
      "Fixture quote was added to your site, but Fixture fixture-needs wasn't. Try again in a minute.",
    );
    expect(dialog.textContent).not.toContain("nothing changed");
    expect(state.refresh).toHaveBeenCalled();
    // The requirement is on now, so the retry is a plain Add of the add-on itself.
    click(button(dialog, "Add to site"));
    await flush();
    expect(actions.addAddonAction).toHaveBeenCalledWith(
      "fixture-needs",
      "tok-x",
    );
    expect(actions.addBothAction).toHaveBeenCalledTimes(1);
  });

  it("a conflict names the other add-on and disables the button", async () => {
    db.activeAddons.mockResolvedValue(["fixture-quote"]);
    const el = await detail("fixture-conflicts");
    expect(el.textContent).toContain(
      "Fixture fixture-conflicts can't run alongside Fixture quote. Remove Fixture quote first.",
    );
    expect(button(el, "Add to site")!.disabled).toBe(true);
    expect(el.textContent).toContain("Can't be used with: Fixture quote");
  });

  it("an Admin is told only the owner can add", async () => {
    signInAs({ ...OWNER, role: "admin" });
    const el = await detail("testimonials");
    expect(el.textContent).toContain(
      "Only the site owner can add or remove add-ons.",
    );
    expect(button(el, "Add to site")!.disabled).toBe(true);
  });

  it("staff viewing as the owner can't add", async () => {
    signInAs({ ...OWNER, impersonator: "staff1" });
    const el = await detail("testimonials");
    expect(el.textContent).toContain(
      "Add-ons can't be added while you're viewing as the owner. Use the staff console to add one.",
    );
    expect(button(el, "Add to site")!.disabled).toBe(true);
  });

  it("when added: Manage + View on site, and Remove asks with Keep it focused", async () => {
    db.activeAddons.mockResolvedValue(["testimonials"]);
    db.listOrgAddons.mockResolvedValue([
      {
        addon: "testimonials",
        status: "active",
        seeded: { page: { id: "p9", slug: "testimonials" } },
      },
    ]);
    actions.removeAddonAction.mockResolvedValue({
      ok: true,
      data: { slug: "testimonials" },
    });
    actions.addAddonAction.mockResolvedValue({
      ok: true,
      data: {
        slug: "testimonials",
        outcome: "reinstalled",
        tabHref: "/hub/website?tab=testimonials",
        pageUrl: null,
      },
    });
    const el = await detail("testimonials");
    expect(el.textContent).toContain("On your site");
    const manage = Array.from(el.querySelectorAll("a")).find(
      (a) => a.textContent === "Manage testimonials",
    );
    expect(manage?.getAttribute("href")).toBe("/hub/website?tab=testimonials");
    const view = el.querySelector(
      'a[aria-label="View Testimonials page (opens in a new tab)"]',
    );
    expect(view?.getAttribute("href")).toBe(
      "https://palm.example/testimonials",
    );
    expect(view?.getAttribute("target")).toBe("_blank");
    expect(el.textContent).toContain(
      "Its page and blocks stop showing on your site. Your testimonials are kept, so adding it back brings everything back.",
    );

    click(button(el, "Remove from site"));
    const dialog = openDialog()!;
    expect(dialog.textContent).toContain("Remove Testimonials from your site?");
    expect(dialog.textContent).toContain(
      "Its page and blocks stop showing on your site right away. Your testimonials are kept. Add it back any time and everything returns.",
    );
    expect(document.activeElement).toBe(button(dialog, "Keep it"));
    click(button(dialog, "Remove from site"));
    await flush();
    expect(actions.removeAddonAction).toHaveBeenCalledWith("testimonials");
    expect(state.refresh).toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Testimonials was removed. Your testimonials are kept.",
    );
    // D-UI-P5-8 resolved (10-31): Add it back opens the Add confirm with its money block.
    click(button(document.body, "Add it back"));
    await flush();
    expect(actions.addAddonAction).not.toHaveBeenCalled();
    const again = openDialog()!;
    expect(again.textContent).toContain("Add Testimonials to your site?");
    expect(again.textContent).toContain(
      "It joins your order: $9/mo from checkout, no setup fee.",
    );
    expect(actions.addAddonPreviewAction).toHaveBeenCalledWith("testimonials");
    click(button(again, "Add to site"));
    await flush();
    expect(actions.addAddonAction).toHaveBeenCalledWith(
      "testimonials",
      "tok-x",
    );
    expect(openDialog()).toBeNull();
  });

  it("a rejected remove or add-back request unlocks with the fallback copy (C-WR-01)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.activeAddons.mockResolvedValue(["testimonials"]);
    actions.removeAddonAction.mockRejectedValueOnce(new Error("413"));
    const el = await detail("testimonials");
    click(button(el, "Remove from site"));
    click(button(openDialog()!, "Remove from site"));
    await flush();
    const dialog = openDialog()!;
    expect(dialog.textContent).toContain(
      "Testimonials wasn't removed, and your site hasn't changed. Try again in a minute.",
    );
    click(button(dialog, "Keep it"));
    expect(openDialog()).toBeNull();

    // Remove succeeds; the toast's Add it back then rejects: a toast, no unhandled rejection.
    actions.removeAddonAction.mockResolvedValueOnce({
      ok: true,
      data: { slug: "testimonials" },
    });
    actions.addAddonAction.mockRejectedValueOnce(new Error("offline"));
    click(button(el, "Remove from site"));
    click(button(openDialog()!, "Remove from site"));
    await flush();
    click(button(document.body, "Add it back"));
    await flush();
    click(button(openDialog()!, "Add to site"));
    await flush();
    err.mockRestore();
    expect(document.body.textContent).toContain(
      "Testimonials wasn't added, and nothing changed on your site.",
    );
  });

  it("refuses removal up front, naming active dependents with links", async () => {
    db.activeAddons.mockResolvedValue(["fixture-quote", "fixture-needs"]);
    const el = await detail("fixture-quote");
    const section = el.querySelector(
      'section[aria-labelledby="remove-heading"]',
    )!;
    expect(section.textContent).toContain(
      "Fixture fixture-needs needs Fixture quote. Remove Fixture fixture-needs first.",
    );
    expect(
      section.querySelector('a[href="/hub/add-ons/fixture-needs"]'),
    ).not.toBeNull();
    expect(button(section, "Remove from site")!.disabled).toBe(true);
  });

  it("a remove refused by the server shows the dependents instead of the dialog", async () => {
    db.activeAddons.mockResolvedValue(["fixture-quote"]);
    actions.removeAddonAction.mockResolvedValue({
      ok: false,
      code: "addon_required_by",
      message: "x",
      dependents: [{ slug: "fixture-needs", name: "Fixture fixture-needs" }],
    });
    const el = await detail("fixture-quote");
    click(button(el, "Remove from site"));
    click(button(openDialog()!, "Remove from site"));
    await flush();
    expect(openDialog()).toBeNull();
    expect(el.textContent).toContain(
      "Fixture fixture-needs needs Fixture quote. Remove Fixture fixture-needs first.",
    );
  });
});

describe("prices and paused add-ons (10-31; BILL-18, BILL-03)", () => {
  it("cards show the catalog price: $9/mo, Included, Price coming soon", async () => {
    setPrice("builder-pro", 0);
    setPrice("credentials", null);
    const el = await catalog();
    const price = (i: number) =>
      el.querySelectorAll("article")[i]!.querySelector("[data-addon-price]")
        ?.textContent;
    expect(price(0)).toBe("$9/mo");
    expect(price(1)).toBe("Price coming soon");
    expect(price(2)).toBe("Included");
  });

  it("an unpriced add-on's Add is aria-disabled with UNPRICED-ADDON and opens nothing", async () => {
    setPrice("credentials", null);
    const el = await catalog();
    const card = el.querySelectorAll("article")[1]!;
    const add = button(card, "Add to site")!;
    expect(add.getAttribute("aria-disabled")).toBe("true");
    expect(card.textContent).toContain(
      "We're finalising this price. You'll be able to add it soon.",
    );
    click(add);
    expect(openDialog()).toBeNull();
    const d = await detail("credentials");
    expect(d.textContent).toContain("Price coming soon");
    expect(button(d, "Add to site")!.getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("a billing-lapsed add-on is Paused on its card with Details only", async () => {
    db.listOrgAddons.mockResolvedValue([
      {
        addon: "testimonials",
        status: "disabled",
        disabled_reason: "billing_lapse",
        seeded: {},
      },
    ]);
    const el = await catalog();
    const card = el.querySelectorAll("article")[0]!;
    expect(card.textContent).toContain("Paused");
    expect(card.textContent).not.toContain("On your site");
    expect(card.querySelectorAll("button")).toHaveLength(0);
    // An owner-removed add-on is not paused.
    db.listOrgAddons.mockResolvedValue([
      {
        addon: "testimonials",
        status: "disabled",
        disabled_reason: "uninstalled",
        seeded: {},
      },
    ]);
    mounted?.unmount();
    const again = await catalog();
    expect(again.querySelectorAll("article")[0]!.textContent).not.toContain(
      "Paused",
    );
  });

  it("detail: price under the name; paused shows PAUSED-ADDON, Update card and pay and Remove", async () => {
    db.listOrgAddons.mockResolvedValue([
      {
        addon: "testimonials",
        status: "disabled",
        disabled_reason: "billing_lapse",
        seeded: {},
      },
    ]);
    actions.updateCardAction.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message: "Finish checkout first.",
    });
    const el = await detail("testimonials");
    expect(el.querySelector("[data-addon-price]")?.textContent).toBe("$9/mo");
    expect(el.textContent).toContain("Paused");
    expect(el.textContent).toContain(
      "Testimonials is paused because payment stopped. Your testimonials are kept and come back when you pay.",
    );
    expect(button(el, "Add to site")).toBeNull();
    const pay = button(el, "Update card and pay")!;
    expect(pay).not.toBeNull();
    expect(
      el.querySelector('section[aria-labelledby="remove-heading"]'),
    ).not.toBeNull();
    click(pay);
    await flush();
    expect(actions.updateCardAction).toHaveBeenCalledOnce();
    expect(el.textContent).toContain("Finish checkout first.");
  });

  it("an Admin sees the paused alert but no Update card and pay", async () => {
    signInAs({ ...OWNER, role: "admin" });
    db.listOrgAddons.mockResolvedValue([
      {
        addon: "testimonials",
        status: "disabled",
        disabled_reason: "billing_lapse",
        seeded: {},
      },
    ]);
    const el = await detail("testimonials");
    expect(el.textContent).toContain("is paused because payment stopped");
    expect(button(el, "Update card and pay")).toBeNull();
  });
});

describe("Add confirm money block (10-31; BILL-12, D186)", () => {
  const BEFORE_LAUNCH = {
    kind: "charge",
    rows: [
      {
        label: "Today",
        amount: "$3.48",
        detail: "for the rest of October",
        strong: true,
      },
      { label: "Then", amount: "$9/mo", detail: null, strong: false },
    ],
    note: "No setup fee before your site launches.",
    cardLine: "Plus sales tax. Charged to Visa ending 4242.",
    todayCents: 348,
    confirmLabel: "Add and pay $3.48",
  };
  const AFTER_LAUNCH = {
    kind: "charge",
    rows: [
      { label: "Setup", amount: "$25.00", detail: null, strong: false },
      {
        label: "Rest of October",
        amount: "$3.48",
        detail: null,
        strong: false,
      },
      { label: "Today", amount: "$28.48", detail: null, strong: true },
      {
        label: "Then",
        amount: "$9/mo",
        detail: "on your monthly bill",
        strong: false,
      },
    ],
    note: null,
    cardLine: "Plus sales tax. Charged to Visa ending 4242.",
    todayCents: 2848,
    confirmLabel: "Add and pay $28.48",
  };

  async function openAdd(slugIndex = 1): Promise<HTMLDialogElement> {
    const el = await catalog();
    click(button(el.querySelectorAll("article")[slugIndex]!, "Add to site"));
    return openDialog()!;
  }

  it("shows a skeleton and a disabled primary until the server preview arrives", async () => {
    let resolve!: (v: unknown) => void;
    actions.addAddonPreviewAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const dialog = await openAdd();
    expect(dialog.querySelector("[data-money-skeleton]")).not.toBeNull();
    expect(
      (dialog.querySelector("[data-add-primary]") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    resolve({ ok: true, preview: BEFORE_LAUNCH });
    await flush();
    expect(dialog.querySelector("[data-money-skeleton]")).toBeNull();
    expect(document.activeElement).toBe(button(dialog, "Add and pay $3.48"));
  });

  it("before checkout: It joins your order, primary Add to site", async () => {
    const dialog = await openAdd();
    await flush();
    expect(actions.addAddonPreviewAction).toHaveBeenCalledWith("credentials");
    expect(dialog.textContent).toContain(
      "It joins your order: $9/mo from checkout, no setup fee.",
    );
    expect(button(dialog, "Add to site")).not.toBeNull();
  });

  it("after payment, before launch: Today / Then / no setup fee, Add and pay $3.48", async () => {
    actions.addAddonPreviewAction.mockResolvedValue({
      ok: true,
      preview: BEFORE_LAUNCH,
    });
    const dialog = await openAdd();
    await flush();
    expect(dialog.textContent).toContain("Today ·$3.48for the rest of October");
    expect(dialog.textContent).toContain("Then ·$9/mo");
    expect(dialog.textContent).toContain(
      "No setup fee before your site launches.",
    );
    expect(button(dialog, "Add and pay $3.48")).not.toBeNull();
  });

  it("after launch: Setup, Rest of October, Today, Then; pending Charging your card…", async () => {
    actions.addAddonPreviewAction.mockResolvedValue({
      ok: true,
      preview: AFTER_LAUNCH,
    });
    let finish!: (v: unknown) => void;
    actions.addAddonAction.mockReturnValue(
      new Promise((r) => {
        finish = r;
      }),
    );
    const dialog = await openAdd();
    await flush();
    for (const t of [
      "Setup ·$25.00",
      "Rest of October ·$3.48",
      "Today ·$28.48",
      "Then ·$9/moon your monthly bill",
    ]) {
      expect(dialog.textContent).toContain(t);
    }
    click(button(dialog, "Add and pay $28.48"));
    await flush();
    expect(dialog.textContent).toContain("Charging your card…");
    finish({
      ok: true,
      data: {
        slug: "credentials",
        outcome: "installed",
        tabHref: "/hub/website?tab=credentials",
        pageUrl: null,
      },
    });
    await flush();
    expect(document.body.textContent).toContain(
      "Credentials is on your site. Receipt emailed.",
    );
  });

  it("declined card: ERR-CARD with Update card in the dialog, nothing added", async () => {
    actions.addAddonPreviewAction.mockResolvedValue({
      ok: true,
      preview: AFTER_LAUNCH,
    });
    actions.addAddonAction.mockResolvedValue({
      ok: false,
      code: "card_declined",
      message: "Your card was declined. Update it in Settings › Billing.",
    });
    const dialog = await openAdd();
    await flush();
    click(button(dialog, "Add and pay $28.48"));
    await flush();
    expect(openDialog()).not.toBeNull();
    expect(dialog.textContent).toContain(
      "Your card was declined. Update it in Settings › Billing.",
    );
    expect(dialog.textContent).toContain("Nothing was added.");
    expect(button(dialog, "Update card")).not.toBeNull();
    expect(state.push).not.toHaveBeenCalled();
  });

  it("CR-C01: a moved price at confirm shows the new figure; the retry sends the new token", async () => {
    actions.addAddonPreviewAction
      .mockResolvedValueOnce({ ok: true, preview: AFTER_LAUNCH, token: "t-1" })
      .mockResolvedValueOnce({
        ok: true,
        preview: BEFORE_LAUNCH,
        token: "t-2",
      });
    actions.addAddonAction
      .mockResolvedValueOnce({
        ok: false,
        code: "price_changed",
        message:
          "The price changed since you opened this. Check the new figure, then confirm again.",
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          slug: "credentials",
          outcome: "installed",
          tabHref: "/hub/website?tab=credentials",
          pageUrl: null,
        },
      });
    const dialog = await openAdd();
    await flush();
    click(button(dialog, "Add and pay $28.48"));
    await flush();
    expect(actions.addAddonAction).toHaveBeenLastCalledWith(
      "credentials",
      "t-1",
    );
    expect(dialog.textContent).toContain(
      "The price changed since you opened this.",
    );
    expect(actions.addAddonPreviewAction).toHaveBeenCalledTimes(2);
    expect(button(dialog, "Add and pay $3.48")).not.toBeNull();
    click(button(dialog, "Add and pay $3.48"));
    await flush();
    expect(actions.addAddonAction).toHaveBeenLastCalledWith(
      "credentials",
      "t-2",
    );
    expect(state.push).toHaveBeenCalledWith("/hub/website?tab=credentials");
  });

  it("paused account: PAUSED-NO-ADD with Update card and pay and no add button", async () => {
    actions.addAddonPreviewAction.mockResolvedValue({
      ok: false,
      reason: "paused",
      message:
        "Your add-ons are paused until your overdue bill is paid. Pay it first, then add new ones.",
    });
    const dialog = await openAdd();
    await flush();
    expect(dialog.textContent).toContain(
      "Your add-ons are paused until your overdue bill is paid. Pay it first, then add new ones.",
    );
    expect(button(dialog, "Update card and pay")).not.toBeNull();
    expect(dialog.querySelector("[data-add-primary]")).toBeNull();
    expect(button(dialog, "Not now")).not.toBeNull();
  });

  it("a gate refusal at confirm (paused since the preview) swaps to PAUSED-NO-ADD", async () => {
    actions.addAddonAction.mockResolvedValue({
      ok: false,
      code: "paused",
      message: "x",
    });
    const dialog = await openAdd();
    await flush();
    click(button(dialog, "Add to site"));
    await flush();
    expect(dialog.textContent).toContain(
      "Your add-ons are paused until your overdue bill is paid.",
    );
    expect(dialog.querySelector("[data-add-primary]")).toBeNull();
  });

  it("a failed preview keeps the dialog without an add button", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    actions.addAddonPreviewAction.mockRejectedValue(new Error("offline"));
    const dialog = await openAdd();
    await flush();
    err.mockRestore();
    expect(dialog.textContent).toContain(
      "We couldn't get your price just now.",
    );
    expect(dialog.querySelector("[data-add-primary]")).toBeNull();
  });

  it("the remove dialog states the monthly drop and credit once checkout is paid", async () => {
    db.activeAddons.mockResolvedValue(["testimonials"]);
    db.readBillingAccount.mockResolvedValue({ paidAt: "2026-10-01" });
    const el = await detail("testimonials");
    click(button(el, "Remove from site"));
    expect(openDialog()?.textContent).toContain(
      "Your monthly bill drops by $9. You get credit for the rest of the month.",
    );
  });

  it("no bill line before checkout is paid", async () => {
    db.activeAddons.mockResolvedValue(["testimonials"]);
    const el = await detail("testimonials");
    click(button(el, "Remove from site"));
    expect(openDialog()?.textContent).not.toContain("Your monthly bill drops");
  });
});
