// 03-13 Task 3: builder Server Actions and the draft preview (CONT-05..08, CONT-30;
// T-03-53, T-03-54, T-03-55). The real session module and runAction run against mocked
// next/headers and @cds/db, so every assertion covers the cookie -> OrgContext path.
import { ToastRegion } from "@cds/ui/hub";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
  usePathname: () => "/hub/website/pages/p1/preview",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  saveSection: vi.fn(),
  reorderSections: vi.fn(),
  setSectionHidden: vi.fn(),
  deleteSection: vi.fn(),
  undoDeleteSection: vi.fn(),
  publishPage: vi.fn(),
  previewPage: vi.fn(),
  readOrganizationDesign: vi.fn(),
  getPage: vi.fn(),
  listSections: vi.fn(),
  listPopups: vi.fn(),
  getContentScanner: vi.fn(() => ({ scan: vi.fn() })),
  getSearchPinger: vi.fn(() => ({ ping: vi.fn() })),
  // P5: the registry's server entry registers add-on collections at load; the builder and
  // preview read the org's active add-ons (05-10).
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  registerAddonAlertTypes: vi.fn(),
  activeAddons: vi.fn(),
  addonRepo: vi.fn(),
  // lib/addons.ts addonDeps() wires the BillingGate stand-in (05-11).
  getBillingGate: vi.fn(() => ({ approve: vi.fn() })),
  // The re-acceptance gate (09-15, review WR-C02): current unless a test says outdated.
  agreementStatus: vi.fn(async () => ({ state: "current" })),
}));
vi.mock("@cds/db", () => db);

const { InvalidInput, NotFound } = await import("@cds/core");
const { SECTION_REGISTRY } = await import("../lib/section-registry");
const sections = await import("../app/actions/sections");
const { publishPageAction } = await import("../app/actions/publish");
const { ALMANAC, ALMANAC_HASH } = await import("./theme-fixture");
const { resolveTheme } = await import("@cds/core/theme");
const builderModule =
  await import("../app/(platform)/hub/website/pages/[pageId]/page");
const previewModule =
  await import("../app/(platform)/hub/website/pages/[pageId]/preview/page");
const { ADDON_REGISTRY } = await import("@cds/addon-registry");

const ORG = { id: "org1", name: "Palm Science", primaryHost: "palm.example" };
const CTX = { orgId: "org1", actor: "u1", role: "owner" };
const ERR_REORDER =
  "That move didn't save, so the block went back to where it was. Try again.";
const ERR_PUBLISH =
  "Publishing didn't finish. Your draft is safe and your live page hasn't changed. Try again in a minute.";

const DRAFT = {
  version: 1,
  page: {
    id: "p1",
    slug: "about",
    title: "About",
    seo: {},
    password_protected: false,
  },
  sections: [],
  published_at: "2026-09-27T10:00:00.000Z",
};

function signIn() {
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
}

const ROW = {
  id: "s1",
  page: "p1",
  section_type: "hero",
  row_layout: "full",
  content: { heading: "Hi" },
  settings: { background_variant: "main" },
  sort_order: 1,
  is_published: true,
};

beforeEach(() => {
  state.jar.clear();
  for (const fn of Object.values(db)) fn.mockReset();
  db.getContentScanner.mockReturnValue({ scan: vi.fn() });
  db.getSearchPinger.mockReturnValue({ ping: vi.fn() });
  db.activeAddons.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("section actions", () => {
  it("saveSectionAction passes the session ctx and the composed registry, never a tenant", async () => {
    signIn();
    db.saveSection.mockResolvedValue(ROW);
    const res = await sections.saveSectionAction({
      pageId: "p1",
      section_type: "hero",
      row_layout: "full",
      content: { heading: "Hi" },
      settings: { background_variant: "alternate" },
      afterId: "s0",
      // A smuggled tenant field must never be forwarded.
      organization: "org-evil",
    } as never);
    expect(res).toEqual({ ok: true, data: ROW });
    expect(db.saveSection).toHaveBeenCalledTimes(1);
    const [ctx, registry, input, addons] = db.saveSection.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(registry).toBe(SECTION_REGISTRY);
    // The add-on registry goes in, so an off add-on's block type is refused (05-10).
    expect(addons).toBe(ADDON_REGISTRY);
    expect(input).toEqual({
      pageId: "p1",
      section_type: "hero",
      row_layout: "full",
      content: { heading: "Hi" },
      settings: { background_variant: "alternate" },
      afterId: "s0",
    });
    expect(Object.keys(input)).not.toContain("organization");
  });

  it("reorderSectionsAction returns the ERR-REORDER copy on InvalidInput", async () => {
    signIn();
    db.reorderSections.mockRejectedValue(new InvalidInput("bad order"));
    const res = await sections.reorderSectionsAction("p1", ["b", "a"]);
    expect(res).toEqual({
      ok: false,
      code: "reorder_failed",
      message: ERR_REORDER,
    });
    expect(db.reorderSections).toHaveBeenCalledWith(CTX, "p1", ["b", "a"]);
  });

  it("setSectionHiddenAction and deleteSectionAction forward ids only", async () => {
    signIn();
    db.setSectionHidden.mockResolvedValue(undefined);
    db.deleteSection.mockResolvedValue(ROW);
    expect(await sections.setSectionHiddenAction("s1", true)).toEqual({
      ok: true,
      data: null,
    });
    expect(db.setSectionHidden).toHaveBeenCalledWith(CTX, "s1", true);
    expect(await sections.deleteSectionAction("s1")).toEqual({
      ok: true,
      data: ROW,
    });
    expect(db.deleteSection).toHaveBeenCalledWith(CTX, "s1");
  });

  it("undoDeleteSectionAction restores through the registry", async () => {
    signIn();
    db.undoDeleteSection.mockResolvedValue(ROW);
    const res = await sections.undoDeleteSectionAction(ROW as never);
    expect(res.ok).toBe(true);
    // The add-on registry goes in too: an add-on block of an add-on that is off does
    // not come back (A-WR-04).
    expect(db.undoDeleteSection).toHaveBeenCalledWith(
      CTX,
      SECTION_REGISTRY,
      ROW,
      ADDON_REGISTRY,
    );
  });

  it("a cross-tenant id comes back as the fixed not-found copy", async () => {
    signIn();
    db.deleteSection.mockRejectedValue(new NotFound("x"));
    const res = await sections.deleteSectionAction("other-org-row");
    expect(res).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("publishPageAction", () => {
  it("reports held with its reasons", async () => {
    signIn();
    db.publishPage.mockResolvedValue({
      status: "held",
      reasons: ["keyword"],
    });
    const res = await publishPageAction("p1");
    expect(res).toEqual({
      ok: true,
      data: { status: "held", reasons: ["keyword"] },
    });
    const [ctx, id, deps] = db.publishPage.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(id).toBe("p1");
    expect(deps.sections).toBe(SECTION_REGISTRY);
  });

  it("reports published", async () => {
    signIn();
    const data = {
      status: "published",
      published_at: "2026-09-27T10:00:00.000Z",
      flagged: false,
      versionKey: "k",
    };
    db.publishPage.mockResolvedValue(data);
    expect(await publishPageAction("p1")).toEqual({ ok: true, data });
  });

  it("WR-C02: an outdated Owner's save and publish return agreement_required, no redirect, no write", async () => {
    signIn();
    db.agreementStatus.mockResolvedValue({ state: "outdated" });
    try {
      const results = await Promise.all([
        sections.saveSectionAction({
          pageId: "p1",
          section_type: "hero",
          row_layout: "full",
          content: {},
        }),
        publishPageAction("p1"),
      ]);
      for (const r of results)
        expect(r).toMatchObject({ ok: false, code: "agreement_required" });
      expect(db.saveSection).not.toHaveBeenCalled();
      expect(db.publishPage).not.toHaveBeenCalled();
    } finally {
      db.agreementStatus.mockResolvedValue({ state: "current" });
    }
  });

  it("turns an unknown failure into the ERR-PUBLISH copy", async () => {
    signIn();
    db.publishPage.mockRejectedValue(new Error("pb exploded: secret detail"));
    const res = await publishPageAction("p1");
    expect(res).toEqual({
      ok: false,
      code: "publish_failed",
      message: ERR_PUBLISH,
    });
  });
});

describe("signed out", () => {
  it("every action returns signed_out and touches nothing", async () => {
    const results = await Promise.all([
      sections.saveSectionAction({
        pageId: "p1",
        section_type: "hero",
        row_layout: "full",
        content: {},
      }),
      sections.reorderSectionsAction("p1", []),
      sections.setSectionHiddenAction("s1", false),
      sections.deleteSectionAction("s1"),
      sections.undoDeleteSectionAction(ROW as never),
      publishPageAction("p1"),
    ]);
    for (const r of results)
      expect(r).toMatchObject({ ok: false, code: "signed_out" });
    expect(db.saveSection).not.toHaveBeenCalled();
    expect(db.publishPage).not.toHaveBeenCalled();
  });
});

describe("preview route", () => {
  const params = Promise.resolve({ pageId: "p1" });

  it("redirects to /sign-in without a session", async () => {
    await expect(previewModule.default({ params })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
    expect(db.previewPage).not.toHaveBeenCalled();
  });

  it("renders the draft in [data-site] with the strip outside it", async () => {
    signIn();
    db.previewPage.mockResolvedValue({
      version: 1,
      page: {
        id: "p1",
        slug: "about",
        title: "About",
        seo: {},
        password_protected: false,
      },
      sections: [
        {
          id: "s1",
          section_type: "hero",
          row_layout: "full",
          content: { heading: "Draft heading here" },
          settings: { background_variant: "main" },
        },
      ],
      published_at: "2026-09-27T10:00:00.000Z",
    });
    const el = (await previewModule.default({ params })) as ReactElement;
    // The hub layout provides the ToastRegion in the app.
    const html = renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
    expect(db.previewPage).toHaveBeenCalledWith(CTX, "p1", SECTION_REGISTRY);
    const strip = html.indexOf(
      "Preview · This is your draft, visitors can&#x27;t see it",
    );
    const site = html.indexOf("data-site");
    expect(strip).toBeGreaterThanOrEqual(0);
    expect(site).toBeGreaterThan(strip);
    expect(html.slice(site)).not.toContain("Preview ·");
    expect(html).toContain("Draft heading here");
    expect(html).toContain("Back to editor");
    expect(html).toContain("Publish changes");
  });

  it("renders add-on blocks with live published, not-held data (D253)", async () => {
    signIn();
    db.activeAddons.mockResolvedValue(["testimonials"]);
    const list = vi.fn().mockResolvedValue([
      { id: "t1", quote: "LIVE QUOTE", author_name: "Ann", is_published: true },
      { id: "t2", quote: "HELD QUOTE", author_name: "Bo", is_published: true },
      { id: "t3", quote: "OFF QUOTE", author_name: "Cy", is_published: false },
    ]);
    const openHolds = vi.fn().mockResolvedValue(["t2"]);
    db.addonRepo.mockReturnValue({ collection: () => ({ list, openHolds }) });
    db.previewPage.mockResolvedValue({
      ...DRAFT,
      sections: [
        {
          id: "s1",
          section_type: "testimonials",
          row_layout: "full",
          content: {
            heading: "Kind words",
            layout: "grid",
            show: "all",
            limit: 6,
          },
          settings: { background_variant: "main" },
        },
      ],
    });
    const el = (await previewModule.default({ params })) as ReactElement;
    const html = renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
    expect(db.activeAddons).toHaveBeenCalledWith(CTX);
    expect(html).toContain("LIVE QUOTE");
    expect(html).not.toContain("HELD QUOTE");
    expect(html).not.toContain("OFF QUOTE");
    expect(html).toMatch(/<h2[^>]*>Kind words<\/h2>/);
    expect(html.match(/<h1/g)?.length).toBe(1);
  });

  it("draws nothing for an add-on block whose add-on is off", async () => {
    signIn();
    db.previewPage.mockResolvedValue({
      ...DRAFT,
      sections: [
        {
          id: "s1",
          section_type: "testimonials",
          row_layout: "full",
          content: { heading: "Kind words" },
          settings: { background_variant: "main" },
        },
      ],
    });
    const el = (await previewModule.default({ params })) as ReactElement;
    const html = renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
    expect(db.addonRepo).not.toHaveBeenCalled();
    expect(html).not.toContain("Kind words");
  });

  it("renders the draft in the org's theme; the strip stays outside it (THEME-02)", async () => {
    signIn();
    db.previewPage.mockResolvedValue(DRAFT);
    db.readOrganizationDesign.mockResolvedValue(ALMANAC);
    const el = (await previewModule.default({ params })) as ReactElement;
    const html = renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
    expect(db.readOrganizationDesign).toHaveBeenCalledWith(CTX);
    const scope = html.indexOf(
      `<div data-site="" data-theme="${ALMANAC_HASH}" class="min-h-screen" lang="en"><style>`,
    );
    expect(scope).toBeGreaterThan(0);
    expect(html).toContain(`[data-site][data-theme="${ALMANAC_HASH}"]{`);
    expect(html).toContain("--site-primary:#7a2e1d");
    expect(html.indexOf("Preview · This is your draft")).toBeLessThan(scope);
    expect(html.slice(scope)).not.toContain("Back to editor");
  });

  it("renders the neutral preset when the org has no design", async () => {
    signIn();
    db.previewPage.mockResolvedValue(DRAFT);
    db.readOrganizationDesign.mockResolvedValue(null);
    const el = (await previewModule.default({ params })) as ReactElement;
    const html = renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
    expect(html).toContain('data-theme="00000000"');
    expect(html).toContain('[data-site][data-theme="00000000"]{');
  });

  it("renders the draft in the neutral preset when the theme read fails (WR-04)", async () => {
    signIn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.previewPage.mockResolvedValue(DRAFT);
    db.readOrganizationDesign.mockRejectedValue(new Error("pb timeout"));
    const el = (await previewModule.default({ params })) as ReactElement;
    const html = renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
    expect(html).toContain('data-theme="00000000"');
    expect(html).toContain("Publish changes");
    expect(log).toHaveBeenCalledWith(
      "[hub] theme read failed",
      expect.any(Error),
    );
    log.mockRestore();
  });

  it("is noindex", async () => {
    const meta = await previewModule.generateMetadata();
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });
});

describe("builder route theme (THEME-02, D-UI-P4-11)", () => {
  it("reads the org theme with the session context and passes it to Builder", async () => {
    signIn();
    db.getPage.mockResolvedValue({ id: "p1", slug: "about", title: "About" });
    db.listSections.mockResolvedValue([]);
    db.listPopups.mockResolvedValue([]);
    db.readOrganizationDesign.mockResolvedValue(ALMANAC);
    const el = (await builderModule.default({
      params: Promise.resolve({ pageId: "p1" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ theme: { hash: string; css: string } }>;
    expect(db.readOrganizationDesign).toHaveBeenCalledWith(CTX);
    expect(el.props.theme).toEqual(resolveTheme(ALMANAC));
    expect(el.props.theme.hash).toBe(ALMANAC_HASH);
  });
});

describe("builder route add-ons (05-10, 05-UI-SPEC Builder integration)", () => {
  it("passes the active add-ons and their block types to Builder", async () => {
    signIn();
    db.getPage.mockResolvedValue({ id: "p1", slug: "about", title: "About" });
    db.listSections.mockResolvedValue([]);
    db.listPopups.mockResolvedValue([]);
    db.readOrganizationDesign.mockResolvedValue(null);
    db.activeAddons.mockResolvedValue(["testimonials"]);
    const el = (await builderModule.default({
      params: Promise.resolve({ pageId: "p1" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{
      activeAddons: string[];
      addonBlocks: { type: string; label: string; icon?: string }[];
    }>;
    expect(db.activeAddons).toHaveBeenCalledWith(CTX);
    expect(el.props.activeAddons).toEqual(["testimonials"]);
    expect(el.props.addonBlocks).toEqual([
      {
        type: "testimonials",
        label: "Testimonials",
        description: "Quotes from your customers",
        icon: "MessageSquareQuote",
      },
    ]);
  });

  it("offers no add-on blocks when none are active", async () => {
    signIn();
    db.getPage.mockResolvedValue({ id: "p1", slug: "about", title: "About" });
    db.listSections.mockResolvedValue([]);
    db.listPopups.mockResolvedValue([]);
    db.readOrganizationDesign.mockResolvedValue(null);
    const el = (await builderModule.default({
      params: Promise.resolve({ pageId: "p1" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ addonBlocks: unknown[] }>;
    expect(el.props.addonBlocks).toEqual([]);
  });
});

describe("builder route theme failure (WR-04)", () => {
  it("a failed theme read still opens the builder, with the neutral theme", async () => {
    signIn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.getPage.mockResolvedValue({ id: "p1", slug: "about", title: "About" });
    db.listSections.mockResolvedValue([]);
    db.listPopups.mockResolvedValue([]);
    db.readOrganizationDesign.mockRejectedValue(new Error("pb timeout"));
    const el = (await builderModule.default({
      params: Promise.resolve({ pageId: "p1" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ theme: { hash: string; css: string } }>;
    expect(el.props.theme).toEqual(resolveTheme(null));
    expect(log).not.toHaveBeenCalledWith(
      "[hub] builder load failed",
      expect.anything(),
    );
    log.mockRestore();
  });
});

describe("hub shell framing", () => {
  it("builder is full width, preview is bare, other screens keep the frame", async () => {
    const { contentMode } = await import("../app/(platform)/hub/HubShell");
    expect(contentMode("/hub/website")).toBe("standard");
    expect(contentMode("/hub/website/pages/p1")).toBe("builder");
    expect(contentMode("/hub/website/pages/p1/preview")).toBe("bare");
    expect(contentMode("/hub/website/pages/p1/other")).toBe("standard");
  });
});
