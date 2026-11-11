// @vitest-environment jsdom
// 13-32 (STAFF-07, D264, P13-P7; T-13-32-01, T-13-32-02): every tenant-facing add-on list
// reads one merged catalog view. /start, the quote action, hub Get add-ons (list + detail)
// and the add actions run against a mocked @cds/db whose publicCatalogView plays the
// console's listings: a tagline override, a coming-soon listing, a hidden one (absent from
// the public view) and a private manifest the view wrongly carries (defence in depth).
import { InvalidInput } from "@cds/core";
import { composeAddonRegistry } from "@cds/core/addons";
import { ToastRegion } from "@cds/ui/hub";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_PRIVATE,
  fixtureManifest,
} from "../../../packages/core/src/addons/__fixtures__/manifests";
import { mount, type Mounted } from "../../../packages/ui/src/test-support/dom";

const state = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: (name: string, value: string) => {
      state.jar.set(name, value);
    },
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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const db = vi.hoisted(() => ({
  publicCatalogView: vi.fn(),
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  activeAddons: vi.fn(),
  listOrgAddons: vi.fn(),
  retainedRecordCounts: vi.fn(),
  listPages: vi.fn(),
  orgPlanPath: vi.fn(),
  readBillingAccount: vi.fn(),
  installAddon: vi.fn(),
  uninstallAddon: vi.fn(),
  previewAddonCharge: vi.fn(),
  billingPortalLink: vi.fn(),
  createQuote: vi.fn(),
  updateQuote: vi.fn(),
  readQuoteByToken: vi.fn(),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  getBillingGate: vi.fn(() => ({ approve: vi.fn() })),
  getContentScanner: vi.fn(() => ({ scan: vi.fn() })),
  getSearchPinger: vi.fn(() => ({ ping: vi.fn() })),
  QUOTE_TOKEN_RE: /^[A-Za-z0-9_-]{43}$/,
  CARD_DECLINED_COPY: "declined",
  CHARGE_PRICE_CHANGED_COPY: "changed",
  PAUSED_NO_ADD_COPY: "paused",
  UNPRICED_ADDON_COPY: "unpriced",
}));
vi.mock("@cds/db", () => db);

vi.mock("../lib/catalog", () => ({ getCatalog: async () => [] }));

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

const OPEN = fixtureManifest({ slug: "fixture-open", order: 900 });
const SOON = fixtureManifest({ slug: "fixture-soon", order: 901 });
const HIDDEN = fixtureManifest({ slug: "fixture-hidden", order: 902 });
// WR-C04: an available add-on whose requirement is a Hidden public listing.
const NEEDS_HIDDEN = fixtureManifest({
  slug: "fixture-needs-hidden",
  order: 903,
  requires: ["fixture-hidden"],
});
const BASE_REGISTRY = composeAddonRegistry(
  [OPEN, SOON, HIDDEN, FIXTURE_PRIVATE],
  { fileExists: () => true },
);
registry.value = BASE_REGISTRY;

const {
  getCatalogState,
  getCatalogView,
  manifestOnlyView,
  resetCatalogSnapshot,
  startAddons,
} = await import("../lib/catalog-view");
const { chooseQuoteAction } = await import("../app/actions/quote");
const { addAddonAction, addBothAction, addAddonPreviewAction } =
  await import("../app/actions/addons");
const { default: StartPage } = await import("../app/(platform)/start/page");
const { Configurator } =
  await import("../app/(platform)/start/_components/Configurator");
const { default: CatalogPage } =
  await import("../app/(platform)/hub/add-ons/page");
const { default: DetailPage } =
  await import("../app/(platform)/hub/add-ons/[slug]/page");
const { QUOTE_BAD_INPUT_COPY } = await import("../lib/action");
const { CATALOG_UNAVAILABLE_COPY } = await import("../lib/catalog-view");
const { comingSoonAddCopy } =
  await import("../app/(platform)/hub/add-ons/catalog-logic");

const TAGLINE = "Collect quotes from visitors, edited in the console.";
const DESCRIPTION = "The long console description.\nSecond line.";

function entry(
  slug: string,
  over: Partial<{
    tagline: string;
    description: string;
    availability: "available" | "coming_soon";
    sort: number;
    private: boolean;
    screenshots: {
      id: string;
      url: string;
      alt: string;
      w: number;
      h: number;
    }[];
  }> = {},
) {
  const availability = over.availability ?? "available";
  const isPrivate = over.private ?? false;
  return {
    slug,
    name: slug,
    tagline: over.tagline ?? `${slug} summary`,
    description: over.description ?? `${slug} summary`,
    screenshots: over.screenshots ?? [],
    availability,
    sort: over.sort ?? 1000,
    pickable: availability === "available" && !isPrivate,
    private: isPrivate,
    path: "both" as const,
    premium: false,
  };
}

/** The console's listings as the public view returns them (hidden already dropped). */
function listingsView() {
  return [
    entry("fixture-soon", { availability: "coming_soon", sort: 10 }),
    entry("fixture-open", {
      tagline: TAGLINE,
      description: DESCRIPTION,
      sort: 20,
      screenshots: [
        {
          id: "s1",
          url: "/_catalog/fixture-open/s1.png",
          alt: "The quote form",
          w: 1600,
          h: 1000,
        },
      ],
    }),
    // A private manifest must never surface even if a listing row carried it.
    entry("fixture-private", { private: true }),
  ];
}

const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const ORG = { id: "org1", name: "Palm", primaryHost: "palm.example" };
let mounted: Mounted | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  resetCatalogSnapshot();
  state.jar.clear();
  state.jar.set("cds_session", "tok");
  db.publicCatalogView.mockResolvedValue(listingsView());
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(OWNER);
  db.activeAddons.mockResolvedValue([]);
  db.listOrgAddons.mockResolvedValue([]);
  db.retainedRecordCounts.mockResolvedValue(0);
  db.orgPlanPath.mockResolvedValue("standard");
  db.readBillingAccount.mockResolvedValue({ paidAt: null });
  db.listPages.mockResolvedValue([]);
  db.installAddon.mockImplementation(async (_c, _d, slug: string) => ({
    slug,
    outcome: "installed",
    page: null,
  }));
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

/** The first element in an RSC tree whose type is `type`. */
function findElement(node: unknown, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findElement(n, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return findElement((node.props as { children?: unknown }).children, type);
}

async function show(el: Promise<ReactElement | never>): Promise<HTMLElement> {
  mounted = mount(<ToastRegion>{await el}</ToastRegion>);
  return mounted.container;
}

describe("getCatalogView (choice 1)", () => {
  it("passes every manifest as catalog input and orders by listing sort", async () => {
    const view = await getCatalogView();
    const input = db.publicCatalogView.mock.calls[0]![0] as {
      slug: string;
      path: string;
      visibility: string;
    }[];
    expect(input.map((m) => m.slug)).toEqual([
      "fixture-open",
      "fixture-soon",
      "fixture-hidden",
      "fixture-private",
    ]);
    expect(input.find((m) => m.slug === "fixture-private")?.visibility).toBe(
      "private",
    );
    expect(view.map((e) => e.slug).slice(0, 2)).toEqual([
      "fixture-soon",
      "fixture-open",
    ]);
  });

  it("ties on sort keep the manifest order, not the name order", async () => {
    db.publicCatalogView.mockResolvedValue([
      entry("fixture-soon"),
      entry("fixture-open"),
    ]);
    const view = await getCatalogView();
    expect(view.map((e) => e.slug)).toEqual(["fixture-open", "fixture-soon"]);
  });

  it("a listing read failure falls back to the manifest-only view and logs the class name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.publicCatalogView.mockRejectedValue(new TypeError("pb down at secret"));
    const view = await getCatalogView();
    expect(view.map((e) => e.slug)).toEqual([
      "fixture-open",
      "fixture-soon",
      "fixture-hidden",
    ]);
    // WR-B04: nothing in the manifest-only fallback is pickable.
    expect(
      view.every((e) => !e.pickable && e.availability === "coming_soon"),
    ).toBe(true);
    expect(view[0]!.tagline).toBe(OPEN.summary);
    expect(JSON.stringify(log.mock.calls)).toContain("TypeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("WR-B04: an outage after a good read serves the last good view, still degraded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await getCatalogState();
    db.publicCatalogView.mockRejectedValue(new TypeError("pb down"));
    const { view, degraded } = await getCatalogState();
    expect(degraded).toBe(true);
    // Hidden stays out, coming soon stays unpickable.
    expect(view.map((e) => e.slug)).not.toContain("fixture-hidden");
    expect(view.find((e) => e.slug === "fixture-soon")?.pickable).toBe(false);
    expect(view.find((e) => e.slug === "fixture-open")?.tagline).toBe(TAGLINE);
  });

  it("manifestOnlyView never includes a private manifest", () => {
    expect(
      manifestOnlyView([OPEN, FIXTURE_PRIVATE]).map((e) => e.slug),
    ).toEqual(["fixture-open"]);
  });
});

describe("/start (choice 2)", () => {
  it("shows the tagline override, the coming-soon add-on disabled, no hidden or private", async () => {
    const tree = await StartPage({ searchParams: Promise.resolve({}) });
    const conf = findElement(tree, Configurator);
    expect(conf).not.toBeNull();
    const props = conf!.props as {
      addons: { slug: string; summary: string }[];
      comingSoon: string[];
    };
    expect(props.addons.map((a) => a.slug)).toEqual([
      "fixture-soon",
      "fixture-open",
    ]);
    expect(props.addons.find((a) => a.slug === "fixture-open")?.summary).toBe(
      TAGLINE,
    );
    expect(props.comingSoon).toEqual(["fixture-soon"]);
  });

  it("drops a stored selection the view no longer offers from the initial choices", async () => {
    state.jar.set("cds_quote", "a".repeat(43));
    db.readQuoteByToken.mockResolvedValue({
      id: "q1",
      status: "draft",
      path: "standard",
      businessType: "therapist",
      businessTypeOther: "",
      email: "",
      selections: {
        addons: ["fixture-open", "fixture-soon", "fixture-hidden"],
        extras: [],
        carePlan: false,
        cadence: "monthly",
      },
      totals: { dueAtCheckoutCents: 1 },
    });
    const tree = await StartPage({ searchParams: Promise.resolve({}) });
    const conf = findElement(tree, Configurator);
    const q = (
      conf!.props as {
        initialQuote: { selections: { addons: string[] }; totals: unknown };
      }
    ).initialQuote;
    expect(q.selections.addons).toEqual(["fixture-open"]);
    expect(q.totals).toBeNull();
  });

  it("startAddons skips a private entry even when the view carries it", () => {
    const { addons } = startAddons(listingsView());
    expect(addons.map((a) => a.slug)).not.toContain("fixture-private");
  });
});

describe("quote action (choice 3, T-13-32-01)", () => {
  const pick = (addons: string[]) =>
    chooseQuoteAction({
      path: "standard",
      selections: { addons, extras: [], carePlan: false, cadence: "monthly" },
    });

  it.each([
    ["fixture-soon"],
    ["fixture-hidden"],
    ["fixture-private"],
    ["nope"],
  ])("refuses %s before any @cds/db call", async (slug) => {
    const res = await pick(["fixture-open", slug]);
    expect(res.error).toBe(QUOTE_BAD_INPUT_COPY);
    expect(db.createQuote).not.toHaveBeenCalled();
    expect(db.updateQuote).not.toHaveBeenCalled();
  });

  it("lets a pickable add-on through", async () => {
    db.createQuote.mockResolvedValue({
      token: "b".repeat(43),
      quote: { id: "q1" },
    });
    db.updateQuote.mockResolvedValue({ quote: { id: "q1" }, removed: [] });
    const res = await pick(["fixture-open"]);
    expect(res.error).toBeNull();
    expect(db.updateQuote).toHaveBeenCalled();
  });

  it("a failed listing read refuses add-ons rather than fail open (WR-D09)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.publicCatalogView.mockRejectedValue(new TypeError("pb down"));
    const res = await pick(["fixture-soon"]);
    log.mockRestore();
    expect(res.error).toBe(CATALOG_UNAVAILABLE_COPY);
    expect(db.createQuote).not.toHaveBeenCalled();
    expect(db.updateQuote).not.toHaveBeenCalled();
  });
});

describe("hub Get add-ons (choice 2)", () => {
  it("cards follow the view: override tagline, coming-soon badge with Add disabled, no hidden/private", async () => {
    const el = await show(CatalogPage() as Promise<ReactElement>);
    const names = Array.from(el.querySelectorAll("article h2")).map(
      (h) => h.textContent,
    );
    expect(names).toEqual([SOON.name, OPEN.name]);
    const [soon, open] = Array.from(el.querySelectorAll("article"));
    expect(open!.textContent).toContain(TAGLINE);
    expect(soon!.textContent).toContain("Coming soon");
    const soonAdd = Array.from(soon!.querySelectorAll("button")).find(
      (b) => b.textContent === "Add to site",
    );
    expect(soonAdd?.getAttribute("aria-disabled")).toBe("true");
    expect(el.textContent).not.toContain("fixture-hidden");
    expect(el.textContent).not.toContain("fixture-private");
  });

  it("detail shows the listing description and screenshots", async () => {
    const el = await show(
      DetailPage({
        params: Promise.resolve({ slug: "fixture-open" }),
      }) as Promise<ReactElement>,
    );
    expect(el.textContent).toContain("The long console description.");
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/_catalog/fixture-open/s1.png");
    expect(img?.getAttribute("alt")).toBe("The quote form");
  });

  it("detail of a coming-soon add-on: badge and a disabled Add to site", async () => {
    const el = await show(
      DetailPage({
        params: Promise.resolve({ slug: "fixture-soon" }),
      }) as Promise<ReactElement>,
    );
    expect(el.textContent).toContain("Coming soon");
    const add = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent === "Add to site",
    );
    expect(add?.getAttribute("aria-disabled")).toBe("true");
  });

  it("detail of a hidden add-on is a 404 unless it is on the site", async () => {
    await expect(
      DetailPage({ params: Promise.resolve({ slug: "fixture-hidden" }) }),
    ).rejects.toThrow("NOT_FOUND");
    db.activeAddons.mockResolvedValue(["fixture-hidden"]);
    const el = await show(
      DetailPage({
        params: Promise.resolve({ slug: "fixture-hidden" }),
      }) as Promise<ReactElement>,
    );
    expect(el.textContent).toContain("Manage");
  });
});

describe("add actions (choice 3, T-13-32-01)", () => {
  it("refuses a coming-soon add-on with InvalidInput copy and never installs", async () => {
    const res = await addAddonAction("fixture-soon");
    expect(res).toMatchObject({
      ok: false,
      message: comingSoonAddCopy(SOON.name),
    });
    expect(res.ok ? "" : res.code).toBe(new InvalidInput("x").code);
    expect(await addBothAction("fixture-soon")).toMatchObject({
      ok: false,
      message: comingSoonAddCopy(SOON.name),
    });
    expect(db.installAddon).not.toHaveBeenCalled();
  });

  it("a hidden add-on reads like an unknown one (not_found)", async () => {
    const hidden = await addAddonAction("fixture-hidden");
    const unknown = await addAddonAction("no-such-addon");
    expect(hidden).toEqual(unknown);
    expect(hidden).toMatchObject({ ok: false, code: "not_found" });
    expect(db.installAddon).not.toHaveBeenCalled();
  });

  it("WR-C04: Add both refuses a requirement whose listing is Hidden (not_found), installing nothing", async () => {
    registry.value = composeAddonRegistry(
      [OPEN, SOON, HIDDEN, NEEDS_HIDDEN, FIXTURE_PRIVATE],
      { fileExists: () => true },
    );
    db.publicCatalogView.mockResolvedValue([
      ...listingsView(),
      entry("fixture-needs-hidden", { sort: 30 }),
    ]);
    try {
      const res = await addBothAction("fixture-needs-hidden");
      expect(res).toMatchObject({ ok: false, code: "not_found" });
      expect(db.installAddon).not.toHaveBeenCalled();
    } finally {
      registry.value = BASE_REGISTRY;
    }
  });

  it("preview of a coming-soon add-on refuses before the charge preview", async () => {
    const res = await addAddonPreviewAction("fixture-soon");
    expect(res).toEqual({
      ok: false,
      reason: "not_found",
      message: comingSoonAddCopy(SOON.name),
    });
    expect(db.previewAddonCharge).not.toHaveBeenCalled();
  });

  it("a failed listing read refuses the add (WR-D09)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.publicCatalogView.mockRejectedValue(new TypeError("pb down"));
    const res = await addAddonAction("fixture-soon");
    log.mockRestore();
    expect(res).toMatchObject({ ok: false, message: CATALOG_UNAVAILABLE_COPY });
    expect(db.installAddon).not.toHaveBeenCalled();
  });

  it("adds an available add-on", async () => {
    const res = await addAddonAction("fixture-open");
    expect(res).toMatchObject({ ok: true });
    expect(db.installAddon.mock.calls[0]![2]).toBe("fixture-open");
  });
});
