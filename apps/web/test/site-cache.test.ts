// apps/web adapters behind the @cds/db content ports (CONT-02, CONT-08, CONT-31; D32, D253;
// RESEARCH Patterns 3/4/7, Pitfall 9). next/cache is mocked so the cache options each read
// registers can be asserted.
import { ADDON_SECTIONS } from "@cds/addon-registry";
import { CORE_SECTIONS } from "@cds/core/content";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheCalls = vi.hoisted(
  () =>
    [] as {
      keyParts: string[];
      opts: { tags?: string[]; revalidate?: number | false };
    }[],
);
const revalidateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...a: unknown[]) => unknown,
    keyParts: string[],
    opts: { tags?: string[]; revalidate?: number | false },
  ) => {
    cacheCalls.push({ keyParts, opts });
    return (...a: unknown[]) => fn(...a);
  },
  revalidateTag,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const state = vi.hoisted(() => ({ header: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      state.header === null ? {} : { "x-cds-tenant-host": state.header },
    ),
}));

const db = vi.hoisted(() => ({
  readSiteManifest: vi.fn(),
  readPublishedPage: vi.fn(),
  readPublicSiteSettings: vi.fn(),
  readPublicPopups: vi.fn(),
  readPublicDesign: vi.fn(),
  siteContextForHost: vi.fn(),
  readPublicLogoId: vi.fn(),
  readPublicBusiness: vi.fn(),
  readAddonSiteState: vi.fn(),
  resolvePublicMedia: vi.fn(),
  readSiteIndex: vi.fn(),
  readPublicAnalytics: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const {
  getManifest,
  getPublishedPage,
  getLiveSite,
  getTheme,
  getConsentNeeds,
  getSiteLogoId,
  getSiteLanguage,
  getSiteIndex,
  getSiteAnalytics,
} = await import("../lib/site-cache");
const { loadSiteChrome, reportHref, fallbackChrome } =
  await import("../lib/site-chrome");
const { nextInvalidator } = await import("../lib/invalidator");
const { resolveSlug, siteForRequest } = await import("../lib/tenant");
const { SECTION_REGISTRY } = await import("../lib/section-registry");
const { contentDeps } = await import("../lib/content");

const site = { orgId: "org1", host: "a.example.com" } as never;

beforeEach(() => {
  cacheCalls.length = 0;
  revalidateTag.mockReset();
  state.header = null;
  for (const f of Object.values(db)) f.mockReset();
  db.readPublicAnalytics.mockResolvedValue({ ga4MeasurementId: null });
});

describe("site-cache (CONT-31, D253)", () => {
  it("getManifest caches under the org site tag with a 300 s safety net", async () => {
    db.readSiteManifest.mockResolvedValue({ pages: {} });
    await expect(getManifest(site)).resolves.toEqual({ pages: {} });
    expect(db.readSiteManifest).toHaveBeenCalledWith(site);
    expect(cacheCalls).toHaveLength(1);
    expect(cacheCalls[0]!.keyParts).toEqual(["manifest", "org1"]);
    expect(cacheCalls[0]!.opts).toEqual({
      tags: ["org:org1:site"],
      revalidate: 300,
    });
  });

  it("getPublishedPage caches under the page and add-ons tags (10-42), keyed by org and page", async () => {
    db.readPublishedPage.mockResolvedValue({ version: 1 });
    await getPublishedPage(site, "p1");
    expect(db.readPublishedPage).toHaveBeenCalledWith(site, "p1");
    expect(cacheCalls[0]!.keyParts).toEqual(["page", "org1", "p1"]);
    expect(cacheCalls[0]!.opts).toEqual({
      tags: ["org:org1:page:p1", "org:org1:addons"],
      revalidate: 300,
    });
  });

  it("getLiveSite reads banner, pop-ups, nav, footer and settings under the live tag, 60 s", async () => {
    const banner = { enabled: true, message: "Hi" };
    const nav = { items: [], cta: null, held: false };
    const settings = {
      language: "es",
      show_translate: true,
      show_search: false,
      allow_ai_crawlers: true,
    };
    db.readPublicSiteSettings.mockResolvedValue({
      banner,
      nav,
      footer: null,
      settings,
    });
    db.readPublicPopups.mockResolvedValue([{ id: "pp1" }]);
    await expect(getLiveSite(site)).resolves.toStrictEqual({
      banner,
      popups: [{ id: "pp1" }],
      nav,
      footer: null,
      settings,
    });
    expect(db.readPublicSiteSettings).toHaveBeenCalledTimes(1);
    expect(cacheCalls[0]!.keyParts).toEqual(["live", "org1"]);
    expect(cacheCalls[0]!.opts).toEqual({
      tags: ["org:org1:live"],
      revalidate: 60,
    });
  });

  it("getTheme caches the raw design under the org theme tag, 60 s (T-04-35)", async () => {
    const design = { name: "Tidewater", sourceHash: "ab".repeat(32) };
    db.readPublicDesign.mockResolvedValue(design);
    await expect(getTheme(site)).resolves.toBe(design);
    expect(db.readPublicDesign).toHaveBeenCalledWith(site);
    expect(cacheCalls).toHaveLength(1);
    expect(cacheCalls[0]!.keyParts).toEqual(["theme", "org1"]);
    expect(cacheCalls[0]!.opts).toEqual({
      tags: ["org:org1:theme"],
      revalidate: 60,
    });
  });

  it("getTheme passes a missing design through as null", async () => {
    db.readPublicDesign.mockResolvedValue(null);
    await expect(getTheme(site)).resolves.toBeNull();
  });
});

describe("site language (07-26, CONT-29)", () => {
  it("getSiteLanguage reads the live settings group", async () => {
    db.readPublicSiteSettings.mockResolvedValue({
      banner: null,
      nav: null,
      footer: null,
      settings: {
        language: "pt-BR",
        show_translate: false,
        show_search: false,
        allow_ai_crawlers: true,
      },
    });
    db.readPublicPopups.mockResolvedValue([]);
    await expect(getSiteLanguage(site)).resolves.toBe("pt-BR");
  });

  it("an entry without settings resolves to the defaults", async () => {
    db.readPublicSiteSettings.mockResolvedValue({ banner: null });
    db.readPublicPopups.mockResolvedValue([]);
    expect((await getLiveSite(site)).settings.language).toBe("en");
  });

  it("a failing read falls back to en and logs no ids", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.readPublicSiteSettings.mockRejectedValue(new Error("pb down org1"));
    db.readPublicPopups.mockResolvedValue([]);
    await expect(getSiteLanguage(site)).resolves.toBe("en");
    expect(log).toHaveBeenCalledWith("[site] language read failed");
    log.mockRestore();
  });
});

describe("site chrome (07-25, D249, D253)", () => {
  const P1 = "aaaaaaaaaaaaaa1";
  const P2 = "aaaaaaaaaaaaaa2";
  const P3 = "aaaaaaaaaaaaaa3";
  const manifest = {
    version: 1,
    pages: {
      home: { id: P1, title: "Home", published_at: "", protected: false },
      about: { id: P2, title: "About", published_at: "", protected: false },
      reviews: { id: P3, title: "Reviews", published_at: "", protected: false },
    },
    redirects: {},
    updated_at: "",
  } as never;
  const live = {
    banner: null,
    popups: [],
    nav: {
      items: [
        {
          id: "h",
          label: "Home",
          target: `page:${P1}`,
          new_tab: false,
          children: [],
        },
        {
          id: "a",
          label: "About",
          target: `page:${P2}`,
          new_tab: false,
          children: [],
        },
        {
          id: "r",
          label: "Reviews",
          target: `page:${P3}`,
          new_tab: false,
          children: [],
        },
      ],
      cta: null,
      held: false,
    },
    footer: null,
  } as never;
  const savedUrl = process.env.CDS_PLATFORM_URL;

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.CDS_PLATFORM_URL;
    else process.env.CDS_PLATFORM_URL = savedUrl;
  });

  it("getSiteLogoId caches the id under the live tag, 60 s", async () => {
    db.readPublicLogoId.mockResolvedValue("logo1");
    await expect(getSiteLogoId(site)).resolves.toBe("logo1");
    expect(cacheCalls[0]!.keyParts).toEqual(["logo", "org1"]);
    expect(cacheCalls[0]!.opts).toEqual({
      tags: ["org:org1:live"],
      revalidate: 60,
    });
  });

  it("reportHref builds the hub URL and falls back to mail", () => {
    process.env.CDS_PLATFORM_URL = "https://cds.test";
    expect(reportHref("rivera.test")).toBe(
      "https://cds.test/report?site=rivera.test",
    );
    process.env.CDS_PLATFORM_URL = "not a url";
    expect(reportHref("rivera.test")).toMatch(
      /^mailto:abuse@[^?]+\?subject=Report%20rivera\.test$/,
    );
  });

  it("loadSiteChrome resolves the menu, logo and footer", async () => {
    db.readPublicBusiness.mockResolvedValue({
      name: "Rivera Bakery",
      phone: "",
      public_email: "",
      address: {
        street: "12 Oak St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
      time_zone: "America/Chicago",
      hours: null,
      socials: [],
    });
    db.readAddonSiteState.mockResolvedValue({
      active: [],
      hiddenPageIds: [P3],
    });
    db.readPublicLogoId.mockResolvedValue("logo1");
    db.resolvePublicMedia.mockResolvedValue({
      logo1: {
        id: "logo1",
        kind: "image",
        src: "/_media/logo1/w480.webp",
        alt: "",
      },
    });
    const c = await loadSiteChrome(site, {
      live,
      manifest,
      now: new Date("2026-05-01T00:00:00Z"),
    });
    expect(c.header.brand.name).toBe("Rivera Bakery");
    expect(c.header.brand.logo?.src).toBe("/_media/logo1/w480.webp");
    expect(db.resolvePublicMedia).toHaveBeenCalledWith(site, ["logo1"], {
      pageId: "site",
    });
    expect(
      c.header.nav.entries.map((e) => (e.kind === "link" ? e.href : "")),
    ).toEqual(["/", "/about"]);
    expect(c.footer.addressLines).toEqual(["12 Oak St", "Austin, TX 78701"]);
    expect(c.footer.copyright).toBe("© 2026 Rivera Bakery");
  });

  it("every read failing still returns usable chrome", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.readPublicBusiness.mockRejectedValue(new Error("x"));
    db.readAddonSiteState.mockRejectedValue(new Error("x"));
    db.readPublicLogoId.mockRejectedValue(new Error("x"));
    const c = await loadSiteChrome(site, { live, manifest, now: new Date() });
    expect(c.header.brand).toEqual({ name: "a.example.com", logo: null });
    expect(c.footer.name).toBe("a.example.com");
    expect(c.footer.addressLines).toEqual([]);
    expect(c.footer.hours).toBeNull();
    expect(c.header.nav.entries).toHaveLength(3);
    expect(log.mock.calls.flat().join(" ")).not.toContain("org1");
    log.mockRestore();
    const f = fallbackChrome("a.example.com", new Date());
    expect(f.header.nav.entries).toEqual([]);
    expect(f.reportHref).toContain("a.example.com");
  });
});

describe("nextInvalidator", () => {
  it("calls revalidateTag once per tag", () => {
    nextInvalidator.invalidate(["a", "b"]);
    expect(revalidateTag).toHaveBeenCalledTimes(2);
    expect(revalidateTag).toHaveBeenNthCalledWith(1, "a");
    expect(revalidateTag).toHaveBeenNthCalledWith(2, "b");
  });
});

describe("resolveSlug", () => {
  it("maps the root to home", () => {
    expect(resolveSlug([])).toBe("home");
    expect(resolveSlug(undefined)).toBe("home");
  });
  it("decodes and lowercases one segment", () => {
    expect(resolveSlug(["About"])).toBe("about");
    expect(resolveSlug(["our%2Dteam"])).toBe("our-team");
  });
  it("rejects nested paths and undecodable segments", () => {
    expect(resolveSlug(["a", "b"])).toBeNull();
    expect(resolveSlug(["%E0"])).toBeNull();
  });
});

describe("siteForRequest (WR-02, IN-11, TEN-04)", () => {
  it("404s without the header, without resolving", async () => {
    await expect(siteForRequest("a.example.com")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(db.siteContextForHost).not.toHaveBeenCalled();
  });
  it("404s when the path segment does not match the header", async () => {
    state.header = "a.example.com";
    await expect(siteForRequest("b.example.com")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(db.siteContextForHost).not.toHaveBeenCalled();
  });
  it("404s when the host does not resolve", async () => {
    state.header = "a.example.com";
    db.siteContextForHost.mockResolvedValue(null);
    await expect(siteForRequest("a.example.com")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
  it("resolves from the header value only (encoded path accepted)", async () => {
    state.header = "a.example.com";
    db.siteContextForHost.mockResolvedValue(site);
    await expect(
      siteForRequest(encodeURIComponent("a.example.com")),
    ).resolves.toBe(site);
    expect(db.siteContextForHost).toHaveBeenCalledWith("a.example.com");
  });
});

describe("section registry and content deps (CONT-02, D32)", () => {
  it("SECTION_REGISTRY holds the core types (base five first), then every add-on type", () => {
    expect(SECTION_REGISTRY.types()).toEqual([
      ...CORE_SECTIONS.map((d) => d.type),
      ...ADDON_SECTIONS.map((d) => d.type),
    ]);
    expect(CORE_SECTIONS.slice(0, 5).map((d) => d.type)).toEqual([
      "columns",
      "hero",
      "text-image",
      "text-only",
      "cta-banner",
    ]);
    expect(SECTION_REGISTRY.types()).toContain("testimonials");
  });
  it("contentDeps wires the registry and the Next invalidator", () => {
    const deps = contentDeps();
    expect(deps.sections).toBe(SECTION_REGISTRY);
    expect(deps.invalidator).toBe(nextInvalidator);
    expect(typeof deps.scanner?.scan).toBe("function");
    expect(typeof deps.pinger?.ping).toBe("function");
    // 07-31: the site index calls publicIndex hooks through the registry.
    expect(typeof deps.addons?.list).toBe("function");
  });
});

describe("getSiteIndex (07-31; CONT-37, D277)", () => {
  it("caches under site + live + addons tags, 300 s, keyed by org", async () => {
    db.readSiteIndex.mockResolvedValue(null);
    await expect(getSiteIndex(site)).resolves.toBeNull();
    expect(db.readSiteIndex).toHaveBeenCalledWith(site);
    expect(cacheCalls[0]!.keyParts).toEqual(["site-index", "org1"]);
    expect(cacheCalls[0]!.opts).toEqual({
      tags: ["org:org1:site", "org:org1:live", "org:org1:addons"],
      revalidate: 300,
    });
  });

  it("logs a failed read without ids and rethrows", async () => {
    db.readSiteIndex.mockRejectedValue(new Error("org1 boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(getSiteIndex(site)).rejects.toThrow("boom");
      expect(err).toHaveBeenCalledWith("[site] index read failed");
    } finally {
      err.mockRestore();
    }
  });
});

describe("getConsentNeeds (CONT-34, 07-14 choice 3)", () => {
  const video = {
    kind: "video",
    source: "link",
    provider: "youtube",
    provider_id: "dQw4w9WgXcQ",
  };
  const page = (sections: unknown[]) => ({ version: 1, sections });

  it("walks every manifest page and enabled pop-ups, cached under site + live tags", async () => {
    db.readSiteManifest.mockResolvedValue({
      pages: {
        home: { id: "p1" },
        map: { id: "p2" },
      },
    });
    db.readPublishedPage.mockImplementation(async (_s: unknown, id: string) =>
      id === "p1"
        ? page([
            {
              section_type: "columns",
              content: { columns: [{ items: [video] }] },
            },
          ])
        : page([{ section_type: "map", content: {} }]),
    );
    db.readPublicPopups.mockResolvedValue([
      {
        enabled: true,
        content: {
          items: [{ kind: "audio", source: "link", provider: "spotify" }],
        },
      },
      {
        enabled: false,
        content: { items: [{ kind: "embed", provider: "calendly" }] },
      },
    ]);
    await expect(getConsentNeeds(site)).resolves.toEqual({
      needed: true,
      frames: [
        { kind: "video", provider: "youtube" },
        { kind: "audio", provider: "spotify" },
        { kind: "map", provider: "google-maps" },
      ],
      analytics: false,
    });
    const consent = cacheCalls.find((c) => c.keyParts[0] === "consent");
    expect(consent?.keyParts).toEqual(["consent", "org1"]);
    expect(consent?.opts).toEqual({
      tags: ["org:org1:site", "org:org1:live"],
      revalidate: 300,
    });
  });

  it("a GA4 measurement id counts as analytics (DASH-11, 11-32)", async () => {
    db.readPublicAnalytics.mockResolvedValue({ ga4MeasurementId: "G-ABC123" });
    db.readSiteManifest.mockResolvedValue({ pages: {} });
    db.readPublicPopups.mockResolvedValue([]);
    await expect(getConsentNeeds(site)).resolves.toEqual({
      needed: true,
      frames: [],
      analytics: true,
    });
    // No manifest yet still reports it: the loader is mounted on every page.
    db.readSiteManifest.mockResolvedValue(null);
    await expect(getConsentNeeds(site)).resolves.toMatchObject({
      needed: true,
      analytics: true,
    });
  });

  it("an analytics read failure counts as no GA4 (nothing loads either)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.readPublicAnalytics.mockRejectedValue(new Error("boom"));
    db.readSiteManifest.mockResolvedValue(null);
    await expect(getConsentNeeds(site)).resolves.toMatchObject({
      analytics: false,
    });
    log.mockRestore();
  });

  it("getSiteAnalytics caches under the site + live tags (60 s)", async () => {
    db.readPublicAnalytics.mockResolvedValue({ ga4MeasurementId: "G-ABC123" });
    await expect(getSiteAnalytics(site)).resolves.toEqual({
      ga4MeasurementId: "G-ABC123",
    });
    const c = cacheCalls.find((x) => x.keyParts[0] === "analytics");
    expect(c?.keyParts).toEqual(["analytics", "org1"]);
    expect(c?.opts).toEqual({
      tags: ["org:org1:site", "org:org1:live"],
      revalidate: 60,
    });
  });

  it("no manifest means nothing needed", async () => {
    db.readSiteManifest.mockResolvedValue(null);
    await expect(getConsentNeeds(site)).resolves.toEqual({
      needed: false,
      frames: [],
      analytics: false,
    });
  });

  it("skips a failing page read without logging ids", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.readSiteManifest.mockResolvedValue({
      pages: { home: { id: "p1" }, about: { id: "p2" } },
    });
    db.readPublishedPage.mockImplementation(async (_s: unknown, id: string) => {
      if (id === "p1") throw new Error("boom p1");
      return page([{ section_type: "map", content: {} }]);
    });
    db.readPublicPopups.mockResolvedValue([]);
    await expect(getConsentNeeds(site)).resolves.toMatchObject({
      needed: true,
      frames: [{ kind: "map", provider: "google-maps" }],
    });
    expect(log).toHaveBeenCalledWith("[site] consent page read failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("p1");
    log.mockRestore();
  });
});
