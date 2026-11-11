// Public tenant route (CONT-08, CONT-11, CONT-12, CONT-31; IN-11 / WR-02 / TEN-04; D187,
// D188, D253; CONTEXT A3-Q1). The page trusts only the middleware-set header, a host the
// resolver rejects renders 404 (never a default org), and only published JSON renders.
import { TENANT_HOST_HEADER } from "@cds/core";
import type { PublishedPage, SiteManifest } from "@cds/core/content";
import { NEUTRAL_DESIGN, type PublicDesign } from "@cds/core/theme";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  header: null as string | null,
  cookies: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      state.header === null ? {} : { "x-cds-tenant-host": state.header },
    ),
  cookies: async () => ({
    get: (name: string) =>
      state.cookies[name] === undefined
        ? undefined
        : { name, value: state.cookies[name] },
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT_308:${to}`);
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

const db = vi.hoisted(() => ({
  siteContextForHost: vi.fn(),
  readSiteManifest: vi.fn(),
  readPublishedPage: vi.fn(),
  readPublicSiteSettings: vi.fn(),
  readPublicPopups: vi.fn(),
  readPublicDesign: vi.fn(),
  readAddonSiteState: vi.fn(),
  readPublicAddonRecords: vi.fn(),
  readPublicBusiness: vi.fn(),
  readPublicLogoId: vi.fn(),
  resolvePublicMedia: vi.fn(),
  // 07-32: the per-request gate read (p3 "members" is protected in the fixture manifest).
  readPageGate: vi.fn(),
  // 09-22: tenant policy pages (footer links, cookie banner privacy link).
  readPublishedSitePolicy: vi.fn(),
  // 11-32: the GA4 measurement id (consent-gated loader).
  readPublicAnalytics: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const pageModule = await import("../app/tenant/[host]/[[...path]]/page");
const { default: TenantPage, generateMetadata } = pageModule;
const { default: TenantLayout } = await import("../app/tenant/[host]/layout");

const SITE = { orgId: "o1", host: "shop.example.com" };

function props(host: string, path?: string[]) {
  return { params: Promise.resolve({ host, path }) };
}

function manifest(over: Partial<SiteManifest> = {}): SiteManifest {
  return {
    version: 1,
    pages: {
      home: { id: "p1", title: "Home", published_at: "", protected: false },
      "about-us": {
        id: "p2",
        title: "About",
        published_at: "",
        protected: false,
      },
      members: {
        id: "p3",
        title: "Members",
        published_at: "",
        protected: true,
      },
    },
    redirects: { about: "about-us" },
    updated_at: "",
    ...over,
  };
}

function published(id: string, title: string, heading: string): PublishedPage {
  return {
    version: 1,
    page: {
      id,
      slug: id,
      title,
      seo: {},
      password_protected: false,
    },
    sections: [
      {
        id: `s-${id}`,
        section_type: "hero",
        row_layout: "full",
        content: { heading },
        settings: {},
      },
    ],
    published_at: "",
  } as unknown as PublishedPage;
}

async function html(p: ReturnType<typeof props>): Promise<string> {
  return renderToStaticMarkup((await TenantPage(p)) as ReactElement);
}

beforeEach(() => {
  state.header = null;
  state.cookies = {};
  for (const f of Object.values(db)) f.mockReset();
  db.readPublicSiteSettings.mockResolvedValue({ banner: null });
  db.readPublicPopups.mockResolvedValue([]);
  db.readPublicDesign.mockResolvedValue(null);
  db.readAddonSiteState.mockResolvedValue({ active: [], hiddenPageIds: [] });
  db.readPublicAddonRecords.mockResolvedValue([]);
  db.readPublicBusiness.mockResolvedValue(null);
  db.readPublicLogoId.mockResolvedValue(null);
  db.resolvePublicMedia.mockResolvedValue({});
  db.readPublishedSitePolicy.mockResolvedValue(null);
  db.readPublicAnalytics.mockResolvedValue({ ga4MeasurementId: null });
  db.readPageGate.mockImplementation((_site: unknown, id: string) =>
    Promise.resolve({ protected: id === "p3", version: 1 }),
  );
});

function resolved() {
  state.header = "shop.example.com";
  db.siteContextForHost.mockResolvedValue(SITE);
}

describe("tenant page host checks (IN-11, WR-02, TEN-04)", () => {
  it("uses the shared header name", () => {
    expect(TENANT_HOST_HEADER).toBe("x-cds-tenant-host");
  });

  it("404s when the header is missing", async () => {
    await expect(TenantPage(props("a.example"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(db.siteContextForHost).not.toHaveBeenCalled();
  });

  it("404s when the header does not match the path segment", async () => {
    state.header = "a.example";
    await expect(TenantPage(props("b.example"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(db.siteContextForHost).not.toHaveBeenCalled();
  });

  it("404s when the resolver returns null", async () => {
    state.header = "a.example";
    db.siteContextForHost.mockResolvedValue(null);
    await expect(TenantPage(props("a.example"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(db.siteContextForHost).toHaveBeenCalledWith("a.example");
  });

  it("resolves from the header only (encoded path segment accepted)", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(null);
    await html(props(encodeURIComponent("shop.example.com")));
    expect(db.siteContextForHost).toHaveBeenCalledTimes(1);
    expect(db.siteContextForHost).toHaveBeenCalledWith("shop.example.com");
  });
});

describe("tenant page render (CONT-08, D187)", () => {
  it("renders the published home page through PageRenderer", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    db.readPublishedPage.mockResolvedValue(
      published("p1", "Home", "Welcome home"),
    );
    const out = await html(props("shop.example.com"));
    expect(out).toContain('<main id="content"');
    expect(out).toMatch(/<h1[^>]*>.*Welcome home/);
    expect(db.readPublishedPage).toHaveBeenCalledWith(SITE, "p1");
  });

  it("404s a page seeded by a disabled add-on (ADDON-05)", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    db.readPublishedPage.mockResolvedValue(published("p2", "About", "About"));
    db.readAddonSiteState.mockResolvedValue({
      active: [],
      hiddenPageIds: ["p2"],
    });
    await expect(
      TenantPage(props("shop.example.com", ["about-us"])),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(db.readPublishedPage).not.toHaveBeenCalled();
  });

  it("generateMetadata suggests the title and stays noindex off a custom host", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    db.readPublishedPage.mockResolvedValue(
      published("p1", "Home", "Welcome home"),
    );
    // 07-30: the home page's suggested title is the business name (suggestTitle).
    db.readPublicBusiness.mockResolvedValue({ name: "Shop Co" });
    const meta = await generateMetadata(props("shop.example.com"));
    expect(meta.title).toBe("Shop Co");
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates?.canonical).toBe("https://shop.example.com/");
  });

  it("prefers the SEO title when set", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    const page = published("p2", "About", "About us");
    page.page.seo = { meta_title: "About Shop", meta_description: "Who" };
    db.readPublishedPage.mockResolvedValue(page);
    const meta = await generateMetadata(
      props("shop.example.com", ["about-us"]),
    );
    expect(meta.title).toBe("About Shop");
    expect(meta.description).toBe("Who");
  });

  it("shows 'No site here yet' when nothing is published", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(null);
    expect(await html(props("shop.example.com"))).toContain("No site here yet");
  });

  it("shows 'No site here yet' when the manifest has no home", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(
      manifest({
        pages: {
          contact: { id: "p9", title: "C", published_at: "", protected: false },
        },
      }),
    );
    expect(await html(props("shop.example.com"))).toContain("No site here yet");
  });

  it("404s an unknown slug, including prototype keys", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    for (const slug of ["nope", "constructor", "__proto__"]) {
      await expect(
        TenantPage(props("shop.example.com", [slug])),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("404s a nested path", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    await expect(
      TenantPage(props("shop.example.com", ["about-us", "x"])),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("redirects a previous slug permanently to the current slug (D188)", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    await expect(
      TenantPage(props("shop.example.com", ["about"])),
    ).rejects.toThrow("NEXT_REDIRECT_308:/about-us");
  });

  it("never redirects to a slug that is not a published page (T-03-52)", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(
      manifest({ redirects: { old: "//evil.example" } }),
    );
    await expect(
      TenantPage(props("shop.example.com", ["old"])),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("redirects /home to the root", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    await expect(
      TenantPage(props("shop.example.com", ["home"])),
    ).rejects.toThrow("NEXT_REDIRECT_308:/");
  });

  it("shows the password gate for a protected page without a cookie (07-32)", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    db.readPublishedPage.mockResolvedValue(
      published("p3", "Members", "Secret recipes"),
    );
    const out = await html(props("shop.example.com", ["members"]));
    expect(out).toContain("data-cds-gate");
    expect(out).toContain('action="/api/gate/p3"');
    expect(out).not.toContain("Secret recipes");
    expect(db.readPageGate).toHaveBeenCalledWith(SITE, "p3");
  });

  it("a failed gate read is locked (fail closed, 07-32)", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    db.readPublishedPage.mockResolvedValue(
      published("p1", "Home", "Welcome home"),
    );
    db.readPageGate.mockRejectedValue(new Error("pb down"));
    const out = await html(props("shop.example.com"));
    expect(out).toContain("data-cds-gate");
    expect(out).not.toContain("Welcome home");
  });

  it("renders eligible pop-ups for this page with PopupHost", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    db.readPublishedPage.mockResolvedValue(
      published("p1", "Home", "Welcome home"),
    );
    db.readPublicPopups.mockResolvedValue([
      {
        id: "pp1",
        name: "Offer",
        trigger: "page-load",
        delay_seconds: 0,
        scroll_percent: 50,
        frequency: "every-visit",
        show_on: "selected-pages",
        page_ids: ["p1"],
        enabled: true,
        content: {
          items: [{ id: "i1", kind: "heading", text: "Deal", level: 2 }],
        },
      },
      {
        id: "pp2",
        name: "Other",
        trigger: "page-load",
        delay_seconds: 0,
        scroll_percent: 50,
        frequency: "every-visit",
        show_on: "selected-pages",
        page_ids: ["p2"],
        enabled: true,
        content: { items: [] },
      },
    ]);
    const out = await html(props("shop.example.com"));
    expect(out).toContain('data-cds-popup="pp1"');
    expect(out).not.toContain('data-cds-popup="pp2"');
  });
});

describe("tenant page core block data (07-07, D253)", () => {
  function withSection(section_type: string): PublishedPage {
    const page = published("p1", "Home", "Welcome home");
    return {
      ...page,
      sections: [
        ...page.sections,
        {
          id: "s-x",
          section_type,
          row_layout: "full",
          content: {},
          settings: {},
        },
      ],
    } as unknown as PublishedPage;
  }

  // 07-30: the JSON-LD script renders before PageRenderer; find the renderer by its props.
  function rendererProps(el: unknown): Record<string, unknown> {
    const kids = (el as ReactElement<{ children: unknown }>).props.children;
    const found = (Array.isArray(kids) ? kids : [kids]).find(
      (k) =>
        typeof k === "object" &&
        k !== null &&
        "registry" in ((k as ReactElement).props as object),
    ) as ReactElement;
    return found.props as Record<string, unknown>;
  }

  it("an hours section reads the public business once and passes coreData", async () => {
    resolved();
    const business = { name: "Rivera Bakery", phone: "512" };
    db.readPublicBusiness.mockResolvedValue(business);
    db.readSiteManifest.mockResolvedValue(manifest());
    db.readPublishedPage.mockResolvedValue(withSection("hours"));
    const el = await TenantPage(props("shop.example.com"));
    // Once for the hours block and once for JSON-LD (07-30); unstable_cache dedups in prod.
    expect(db.readPublicBusiness).toHaveBeenCalledWith(SITE);
    expect(rendererProps(el).coreData).toEqual({
      business,
      media: {},
      galleryPages: {},
    });
    expect(renderToStaticMarkup(el as ReactElement)).toContain("Welcome home");
  });

  it("a social page passes the share URL and title (07-24)", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    const page = withSection("social");
    (page.sections[1] as { content: unknown }).content = { show_share: true };
    db.readPublishedPage.mockResolvedValue(page);
    const el = await TenantPage(props("shop.example.com", ["about-us"]));
    expect((rendererProps(el).coreData as { share?: unknown }).share).toEqual({
      url: "https://shop.example.com/about-us",
      title: "Home",
    });
  });

  it("the home page shares the root URL (07-24)", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    const page = withSection("social");
    (page.sections[1] as { content: unknown }).content = { show_share: true };
    db.readPublishedPage.mockResolvedValue(page);
    const el = await TenantPage(props("shop.example.com"));
    expect(
      (rendererProps(el).coreData as { share?: { url: string } }).share?.url,
    ).toBe("https://shop.example.com/");
  });

  it("a page without a business-bound block gets no business in coreData", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    db.readPublishedPage.mockResolvedValue(withSection("columns"));
    const el = await TenantPage(props("shop.example.com"));
    // 07-30: JSON-LD still reads the business (LocalBusiness on every page).
    expect(rendererProps(el).coreData).toEqual({ media: {}, galleryPages: {} });
  });

  it("hands gallery page numbers from ?g<id>=N to the renderer (07-22)", async () => {
    resolved();
    db.readSiteManifest.mockResolvedValue(manifest());
    db.readPublishedPage.mockResolvedValue(withSection("columns"));
    const el = await TenantPage({
      ...props("shop.example.com"),
      searchParams: Promise.resolve({ gsec1: "2", gbad: "x", q: "3" }),
    });
    expect(
      (rendererProps(el).coreData as { galleryPages?: unknown }).galleryPages,
    ).toEqual({ sec1: 2 });
  });
});

describe("tenant layout (CONT-11, 03-UI-SPEC site rendering contract)", () => {
  function layoutProps() {
    return {
      children: <p>child</p>,
      params: Promise.resolve({ host: "shop.example.com" }),
    };
  }

  it("renders the skip link, [data-site] and children", async () => {
    resolved();
    const out = renderToStaticMarkup(
      (await TenantLayout(layoutProps())) as ReactElement,
    );
    expect(out).toContain("data-site");
    expect(out).toMatch(/<a[^>]*href="#content"[^>]*>Skip to content<\/a>/);
    expect(out).toContain("<p>child</p>");
    expect(out).not.toContain('aria-label="Announcement"');
  });

  it("renders the banner while its window is active", async () => {
    resolved();
    db.readPublicSiteSettings.mockResolvedValue({
      banner: {
        enabled: true,
        message: "Sale today",
        link_text: "",
        link_url: "",
        starts_at: null,
        ends_at: null,
      },
    });
    const out = renderToStaticMarkup(
      (await TenantLayout(layoutProps())) as ReactElement,
    );
    expect(out).toContain('aria-label="Announcement"');
    expect(out).toContain("Sale today");
  });

  it("hides a banner whose window has ended (evaluated per request)", async () => {
    resolved();
    db.readPublicSiteSettings.mockResolvedValue({
      banner: {
        enabled: true,
        message: "Old sale",
        link_text: "",
        link_url: "",
        starts_at: null,
        ends_at: "2000-01-01T00:00:00.000Z",
      },
    });
    const out = renderToStaticMarkup(
      (await TenantLayout(layoutProps())) as ReactElement,
    );
    expect(out).not.toContain("Old sale");
  });

  it("emits the org theme <style> first inside the themed wrapper (THEME-02)", async () => {
    resolved();
    const sourceHash = "3f9a1c2e".repeat(8);
    const tidewater: PublicDesign = {
      schemaVersion: NEUTRAL_DESIGN.schemaVersion,
      name: "Tidewater",
      roles: {
        // An AA role set: the emitter renders non-AA roles as neutral (WR-02).
        surface: "#f4f7f8",
        "surface-raised": "#e6eef1",
        text: "#0f1d26",
        "text-muted": "#44545e",
        primary: "#0f4c5c",
        "primary-contrast": "#ffffff",
        accent: "#b3452d",
        border: "#c5d3d9",
      },
      typography: {
        ...NEUTRAL_DESIGN.typography,
        headingFamily: "Bricolage Grotesque",
        bodyFamily: "Figtree",
      },
      rounded: { ...NEUTRAL_DESIGN.rounded },
      shadows: { ...NEUTRAL_DESIGN.shadows },
      sourceHash,
    };
    db.readPublicDesign.mockResolvedValue(tidewater);
    const out = renderToStaticMarkup(
      (await TenantLayout(layoutProps())) as ReactElement,
    );
    expect(db.readPublicDesign).toHaveBeenCalledWith(SITE);
    expect(out).toMatch(
      /^<div data-site="am-barber" data-theme="3f9a1c2e"[^>]*><style>/,
    );
    expect(out).toContain('[data-site][data-theme="3f9a1c2e"]{');
    expect(out).toContain("--site-primary:#0f4c5c");
    expect(out).toContain('"Bricolage Grotesque Variable"');
    expect(out.indexOf("<style>")).toBeLessThan(out.indexOf("Skip to content"));
  });

  it("renders the neutral preset when the org has no design", async () => {
    resolved();
    const out = renderToStaticMarkup(
      (await TenantLayout(layoutProps())) as ReactElement,
    );
    expect(out).toContain('data-theme="00000000"');
    expect(out).toContain('[data-site][data-theme="00000000"]{');
    expect(out).toContain(`--site-primary:${NEUTRAL_DESIGN.roles.primary}`);
  });

  it("renders the neutral preset when the theme read fails, never a 500 (WR-04)", async () => {
    resolved();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.readPublicDesign.mockRejectedValue(new Error("pb timeout"));
    const out = renderToStaticMarkup(
      (await TenantLayout(layoutProps())) as ReactElement,
    );
    expect(out).toContain('data-theme="00000000"');
    expect(out).toContain("Skip to content");
    expect(log).toHaveBeenCalledWith(
      "[site] theme read failed",
      expect.any(Error),
    );
    log.mockRestore();
  });

  it("renders the neutral preset for an unusable design", async () => {
    resolved();
    db.readPublicDesign.mockResolvedValue({ junk: true });
    const out = renderToStaticMarkup(
      (await TenantLayout(layoutProps())) as ReactElement,
    );
    expect(out).toContain('data-theme="00000000"');
  });

  describe("site chrome (07-25, CONT-13, D249)", () => {
    const render = async (children: ReactElement = <p>child</p>) =>
      renderToStaticMarkup(
        (await TenantLayout({
          children,
          params: Promise.resolve({ host: "shop.example.com" }),
        })) as ReactElement,
      );

    it("orders skip link, banner, header, page, footer", async () => {
      resolved();
      db.readSiteManifest.mockResolvedValue(manifest());
      db.readPublicSiteSettings.mockResolvedValue({
        banner: {
          enabled: true,
          message: "Sale today",
          link_text: "",
          link_url: "",
          starts_at: null,
          ends_at: null,
        },
        nav: {
          items: [
            {
              id: "h",
              label: "Home",
              target: "page:aaaaaaaaaaaaaa1",
              new_tab: false,
              children: [],
            },
          ],
          cta: null,
          held: false,
        },
        footer: null,
      });
      db.readSiteManifest.mockResolvedValue(
        manifest({
          pages: {
            home: {
              id: "aaaaaaaaaaaaaa1",
              title: "Home",
              published_at: "",
              protected: false,
            },
          },
        }),
      );
      const out = await render();
      const order = [
        "Skip to content",
        'aria-label="Announcement"',
        "<header",
        "<p>child</p>",
        "<footer",
      ].map((m) => out.indexOf(m));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(out).toContain('<nav aria-label="Main">');
      expect(out).toMatch(
        /aria-label="Report this site to Support"[^>]*>Report<\/a>/,
      );
      expect(out).toContain(">shop.example.com</span>");
      expect(out).not.toContain("Cookie choices");
    });

    it("a page render through the layout has exactly one h1", async () => {
      resolved();
      db.readSiteManifest.mockResolvedValue(manifest());
      db.readPublishedPage.mockResolvedValue(
        published("p1", "Home", "Welcome home"),
      );
      const page = (await TenantPage(
        props("shop.example.com"),
      )) as ReactElement;
      const out = await render(page);
      expect(out.match(/<h1/g)).toHaveLength(1);
      expect(out.indexOf("<footer")).toBeGreaterThan(
        out.indexOf('<main id="content"'),
      );
    });

    it("a failing chrome read still renders the header and the Report link", async () => {
      resolved();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      db.readPublicBusiness.mockRejectedValue(new Error("pb down"));
      db.readPublicLogoId.mockRejectedValue(new Error("pb down"));
      db.readAddonSiteState.mockRejectedValue(new Error("pb down"));
      const out = await render();
      expect(out).toContain("<header");
      expect(out).toContain('aria-label="Report this site to Support"');
      log.mockRestore();
    });
  });

  describe("site settings (07-26, CONT-29, D237, D-UI-P7-29)", () => {
    const render = async () =>
      renderToStaticMarkup(
        (await TenantLayout({
          children: <p>child</p>,
          params: Promise.resolve({ host: "shop.example.com" }),
        })) as ReactElement,
      );
    const withSettings = (over: Record<string, unknown>) =>
      db.readPublicSiteSettings.mockResolvedValue({
        banner: null,
        nav: {
          items: [
            {
              id: "h",
              label: "Home",
              target: "https://example.org/",
              new_tab: false,
              children: [],
            },
          ],
          cta: null,
          held: false,
        },
        footer: null,
        settings: {
          language: "es",
          show_translate: false,
          show_search: false,
          allow_ai_crawlers: true,
          ...over,
        },
      });

    it("Translate on: the header and the phone panel carry the hidden island, no Google host", async () => {
      resolved();
      withSettings({ show_translate: true });
      const out = await render();
      const header = out.slice(
        out.indexOf("<header"),
        out.indexOf("</header>"),
      );
      expect(header.match(/data-cds-translate=""/g)).toHaveLength(2);
      expect(header).toMatch(/<a data-cds-translate="" hidden=""/);
      expect(out).not.toContain("translate.google.com");
      expect(out).not.toMatch(/<script|<iframe/);
    });

    it("Translate off: no island", async () => {
      resolved();
      withSettings({});
      expect(await render()).not.toContain("data-cds-translate");
    });

    it("Search on: a link to /search named Search this site", async () => {
      resolved();
      withSettings({ show_search: true });
      expect(await render()).toMatch(
        /<a href="\/search" aria-label="Search this site"/,
      );
    });

    it("Search off: no search link", async () => {
      resolved();
      withSettings({});
      expect(await render()).not.toContain("Search this site");
    });

    it("the theme scope carries the site language", async () => {
      resolved();
      withSettings({});
      expect(await render()).toMatch(
        /<div[^>]*data-site[^>]*lang="es"|<div[^>]*lang="es"[^>]*data-site/,
      );
    });
  });

  it("keeps the skip link on site tokens", async () => {
    resolved();
    const out = renderToStaticMarkup(
      (await TenantLayout(layoutProps())) as ReactElement,
    );
    expect(out).toContain("focus:bg-site-surface");
    expect(out).toContain("focus:text-site-text");
  });

  describe("cookie banner (CONT-34, 07-14)", () => {
    const youtubeVideo = {
      id: "v1",
      kind: "video",
      title: "Tour",
      source: "link",
      asset: "",
      provider: "youtube",
      provider_id: "dQw4w9WgXcQ",
    };
    function withFrame(pages?: SiteManifest["pages"]) {
      resolved();
      db.readSiteManifest.mockResolvedValue(
        pages ? manifest({ pages }) : manifest(),
      );
      db.readPublishedPage.mockImplementation(async (_s, id: string) => {
        const page = published(id, id, "Hi");
        if (id === "p2") {
          (page.sections as unknown[]).push({
            id: "s-cols",
            section_type: "columns",
            row_layout: "full",
            content: { columns: [{ items: [youtubeVideo] }] },
            settings: {},
          });
        }
        return page;
      });
    }
    const render = async () =>
      renderToStaticMarkup((await TenantLayout(layoutProps())) as ReactElement);

    it("mounts the banner as the last child when a page has a third-party frame", async () => {
      withFrame();
      const out = await render();
      expect(out).toContain('aria-label="Cookie choices"');
      expect(out).toContain("data-cds-consent-pending");
      expect(out).toContain(
        "This site uses cookies for embedded videos from other companies. Choose what to allow.",
      );
      expect(out.indexOf('aria-label="Cookie choices"')).toBeGreaterThan(
        out.indexOf("<p>child</p>"),
      );
      expect(out).toMatch(/<\/section><\/div>$/);
      expect(out).not.toContain('href="/privacy"');
    });

    it("a GA4 measurement id alone shows the banner, naming visitor statistics (11-32)", async () => {
      resolved();
      db.readSiteManifest.mockResolvedValue(manifest());
      db.readPublishedPage.mockImplementation(async (_s, id: string) =>
        published(id, id, "Hi"),
      );
      expect(await render()).not.toContain('aria-label="Cookie choices"');
      db.readPublicAnalytics.mockResolvedValue({
        ga4MeasurementId: "G-ABC123",
      });
      const out = await render();
      expect(out).toContain('aria-label="Cookie choices"');
      expect(out).toContain("visitor statistics");
      // SSR never emits the gtag script: GaLoader injects it client-side after consent.
      expect(out).not.toContain("googletagmanager");
    });

    it("keeps the controller mounted but hidden when a choice is stored", async () => {
      withFrame();
      state.cookies = { cds_consent: "necessary" };
      const out = await render();
      expect(out).toMatch(
        /<section[^>]*aria-label="Cookie choices"[^>]*hidden/,
      );
      expect(out).not.toContain("data-cds-consent-pending");
    });

    it("treats an unknown cookie value as no choice", async () => {
      withFrame();
      state.cookies = { cds_consent: "ALL" };
      expect(await render()).toContain("data-cds-consent-pending");
    });

    it("puts Cookie choices in the footer before the controller", async () => {
      withFrame();
      const out = await render();
      const footer = out.slice(
        out.indexOf("<footer"),
        out.indexOf("</footer>"),
      );
      expect(footer).toMatch(/<button[^>]*>Cookie choices<\/button>/);
      expect(out.indexOf("</footer>")).toBeLessThan(
        out.indexOf('aria-label="Cookie choices"'),
      );
    });

    it("links Privacy once the privacy policy is published (09-22)", async () => {
      withFrame(manifest().pages);
      expect(await render()).not.toContain('href="/privacy"');
      db.readPublishedSitePolicy.mockImplementation(
        async (_s: unknown, _r: unknown, page: string) =>
          page === "privacy"
            ? {
                page: "privacy",
                templateVersion: 1,
                title: "Privacy policy",
                html: "<p>x</p>",
                clauseIds: [],
                coveredLabels: [],
                draft: true,
                lastUpdated: "2026-10-08",
              }
            : null,
      );
      const out = await render();
      expect(out).toContain('href="/privacy"');
      expect(out).not.toContain('href="/terms"');
    });

    it("renders no banner on a site with nothing from other companies", async () => {
      resolved();
      db.readSiteManifest.mockResolvedValue(manifest());
      db.readPublishedPage.mockImplementation(async (_s, id: string) =>
        published(id, id, "Hi"),
      );
      const out = await render();
      expect(out).not.toContain("Cookie choices");
    });

    it("counts enabled pop-ups only", async () => {
      resolved();
      db.readSiteManifest.mockResolvedValue(manifest());
      db.readPublishedPage.mockImplementation(async (_s, id: string) =>
        published(id, id, "Hi"),
      );
      const popup = { content: { items: [youtubeVideo] } };
      db.readPublicPopups.mockResolvedValue([{ ...popup, enabled: false }]);
      expect(await render()).not.toContain("Cookie choices");
      db.readPublicPopups.mockResolvedValue([{ ...popup, enabled: true }]);
      expect(await render()).toContain('aria-label="Cookie choices"');
    });

    it("a failed needs read means no banner, never a 500", async () => {
      resolved();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      db.readSiteManifest.mockRejectedValue(new Error("pb down"));
      const out = await render();
      expect(out).toContain("<p>child</p>");
      expect(out).not.toContain("Cookie choices");
      expect(log).toHaveBeenCalledWith("[site] consent needs failed");
      log.mockRestore();
    });
  });

  it("404s the layout for an unresolved host", async () => {
    state.header = "shop.example.com";
    db.siteContextForHost.mockResolvedValue(null);
    await expect(TenantLayout(layoutProps())).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
