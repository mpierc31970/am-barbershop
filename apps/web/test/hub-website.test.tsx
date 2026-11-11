// 03-11 Task 2: hub shell, Website tabs and the Pages tab (D311, D63, CONT-30, UI-SPEC
// "Hub shell" / "Pages tab"; T-03-42). The real session module runs against mocked
// next/headers and @cds/db; pages render with renderToStaticMarkup (node, no jsdom).
import { ToastRegion } from "@cds/ui/hub";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  pathname: "/hub/website",
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
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath }));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

const db = vi.hoisted(() => ({
  signInMember: vi.fn(),
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  listPages: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
  addPageToNav: vi.fn(),
  getNav: vi.fn(),
  getFooter: vi.fn(),
  listPopups: vi.fn(),
  listMedia: vi.fn(),
  resolveHubMedia: vi.fn(),
  readOrganizationDesign: vi.fn(),
  getBusinessProfile: vi.fn(),
  activeAddons: vi.fn(async () => [] as string[]),
  pausedAddons: vi.fn(async () => [] as string[]),
  getOrgStage: vi.fn(async () => ({ stage: "", path: "" })),
  // 11-28: the Pages tab counter and the at-limit panel's reads.
  pagesUsage: vi.fn(async () => ({ used: 4, allowance: 10 })),
  readBillingAccount: vi.fn(async () => null),
  readPriceCatalog: vi.fn(async () => []),
  getIntakeSnapshot: vi.fn(),
  addonRepo: vi.fn(),
  addonPageInfo: vi.fn(),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  registerAddonAlertTypes: vi.fn(),
  getBillingGate: vi.fn(),
  getContentScanner: vi.fn(),
  getSearchPinger: vi.fn(),
  listLibrary: vi.fn(),
  mediaUsage: vi.fn(),
  videoStates: vi.fn(),
  getSiteSettings: vi.fn(),
  siteContextForHost: vi.fn(),
  // 07-30: Site settings shows the generated site icons; WR-C06: the render only reads them.
  refreshSiteIcons: vi.fn(),
  readOwnSiteIcons: vi.fn(),
  // 11-30: page delete, restore and Recently deleted.
  pageDeleteCase: vi.fn(),
  deletePage: vi.fn(),
  restoreDeletedPage: vi.fn(),
  listRecentlyDeleted: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock("@cds/db", async () => {
  const { CdsError } = await import("@cds/core");
  class SlugTaken extends CdsError {
    override readonly code = "slug_taken";
  }
  return {
    ...db,
    SlugTaken,
    RESERVED_SLUGS: [
      "api",
      "_next",
      "sitemap.xml",
      "robots.txt",
      "hub",
      "sign-in",
    ],
    SLUG_RE: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  };
});

const siteCache = vi.hoisted(() => ({ getConsentNeeds: vi.fn() }));
vi.mock("../lib/site-cache", async (orig) => ({
  ...(await orig<typeof import("../lib/site-cache")>()),
  ...siteCache,
}));

const { WEBSITE_TABS, SHELL_PANEL_BODY, resolveTab, composeWebsiteTabs } =
  await import("../app/(platform)/hub/website/tabs");
const { groupsOf, recordView } =
  await import("../app/(platform)/hub/website/AddonPanel");
const { slugify, slugError, formatLastPublished, SLUG_PATTERN } =
  await import("../app/(platform)/hub/website/page-slug");
const { default: HubLayout } = await import("../app/(platform)/hub/layout");
const { default: WebsitePage } =
  await import("../app/(platform)/hub/website/page");
const {
  createPageAction,
  updatePageAction,
  pageDeleteCaseAction,
  deletePageAction,
  restoreDeletedPageAction,
} = await import("../app/actions/pages");
const { default: HubError } = await import("../app/(platform)/hub/error");
const { default: BuilderLoading } =
  await import("../app/(platform)/hub/website/pages/[pageId]/loading");
const { default: PreviewLoading } =
  await import("../app/(platform)/hub/website/pages/[pageId]/preview/loading");

const ORG = { id: "org1", name: "Palm Science", primaryHost: "palm.example" };
const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };

function page(over: Record<string, unknown>) {
  return {
    id: "p",
    slug: "x",
    title: "X",
    status: "draft",
    published_at: null,
    has_unpublished_changes: true,
    kind: "builder",
    password_protected: false,
    seo: {},
    previous_slugs: [],
    ...over,
  };
}

const PAGES = [
  page({
    id: "p-about",
    slug: "about",
    title: "About",
    status: "published",
    published_at: "2026-09-12 14:14:00.000Z",
    has_unpublished_changes: true,
  }),
  page({
    id: "p-home",
    slug: "home",
    title: "Home",
    status: "published",
    published_at: "2026-09-10 09:00:00.000Z",
    has_unpublished_changes: false,
  }),
  page({ id: "p-contact", slug: "contact", title: "Contact", status: "held" }),
  page({ id: "p-faq", slug: "faq", title: "FAQ" }),
];

function signIn() {
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
}

async function renderWebsite(tab?: string): Promise<string> {
  const el = (await WebsitePage({
    searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
  })) as ReactElement;
  return renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
}

beforeEach(() => {
  state.jar.clear();
  state.pathname = "/hub/website";
  for (const fn of Object.values(db)) fn.mockReset();
  revalidatePath.mockReset();
});

const CORE_IDS = [
  "pages",
  "services",
  "media",
  "forms",
  "navigation",
  "footer",
  "banner",
  "popups",
  "site",
];

describe("WEBSITE_TABS (D311, one source)", () => {
  it("starts with Pages", () => {
    expect(WEBSITE_TABS[0]).toEqual({ id: "pages", label: "Pages" });
  });

  it("is the nine core tabs in D-UI-P7-2 order", () => {
    expect(WEBSITE_TABS.map((t) => t.id)).toEqual(CORE_IDS);
    expect(WEBSITE_TABS.map((t) => t.label)).toEqual([
      "Pages",
      "Services",
      "Media",
      "Forms",
      "Navigation",
      "Footer",
      "Banner",
      "Pop-ups",
      "Site settings",
    ]);
    for (const id of ["media", "forms", "navigation", "footer", "site"]) {
      expect(resolveTab(id).id).toBe(id);
    }
  });

  it("resolves known tabs and falls back to the first", () => {
    expect(resolveTab("pages").id).toBe("pages");
    expect(resolveTab("bogus").id).toBe("pages");
    expect(resolveTab(undefined).id).toBe("pages");
    expect(resolveTab(["pages", "x"]).id).toBe("pages");
  });
});

describe("Website shell tabs (07-03, D-UI-P7-2)", () => {
  // 07-17 replaced the Media shell, 07-25 Navigation/Footer, 07-26 Site settings (tested below).
  it("?tab=media opens the media library (07-17), never an add-on panel", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    db.listLibrary.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      perPage: 60,
      counts: { all: 0, images: 0, videos: 0, audio: 0 },
      needsDescription: 0,
    });
    db.mediaUsage.mockResolvedValue({
      usedBytes: 0,
      allowanceBytes: 2 * 1024 ** 3,
      ratio: 0,
      level: "ok",
      assets: 0,
      byKind: { image: 0, video: 0, audio: 0 },
      label: "0 GB of 2 GB used",
    });
    db.getBusinessProfile.mockResolvedValue({ time_zone: "UTC" });
    const html = await renderWebsite("media");
    expect(html).toMatch(/<a[^>]*href="\?tab=media"[^>]*aria-current="page"/);
    expect(html).toMatch(/<h2[^>]*>Media<\/h2>/);
    expect(html).toContain("No media yet");
    expect(html).not.toContain(SHELL_PANEL_BODY.replace("'", "&#x27;"));
    expect(db.addonRepo).not.toHaveBeenCalled();
  });

  // 07-25 replaced the Navigation and Footer shells.
  function chromeMocks() {
    db.listPages.mockResolvedValue([
      page({ id: "aaaaaaaaaaaaaa1", slug: "home", title: "Home" }),
      page({ id: "aaaaaaaaaaaaaa2", slug: "about", title: "About" }),
    ]);
    db.listPopups.mockResolvedValue([]);
    db.listMedia.mockResolvedValue([]);
    db.resolveHubMedia.mockResolvedValue({});
    db.readOrganizationDesign.mockResolvedValue(null);
    db.getSiteSettings.mockResolvedValue({
      language: "en",
      show_translate: false,
      show_search: false,
      allow_ai_crawlers: true,
    });
  }

  it("?tab=navigation renders the menu editor with a live header preview", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    chromeMocks();
    db.getNav.mockResolvedValue({
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
    });
    const html = await renderWebsite("navigation");
    expect(html).toMatch(/<h2[^>]*>Navigation<\/h2>/);
    expect(html).toContain("Changes show on your site as soon as you save.");
    expect(html).toContain("data-site");
    expect(html).toContain("<header");
    expect(html).toContain("Menu links");
    expect(html).toContain("Save navigation");
    expect(html).not.toContain(SHELL_PANEL_BODY.replace("'", "&#x27;"));
    expect(db.getNav).toHaveBeenCalledWith(CTX);
    expect(db.addonRepo).not.toHaveBeenCalled();
  });

  it("?tab=footer renders the footer editor with the Report link in the preview", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    chromeMocks();
    db.getFooter.mockResolvedValue(null);
    db.getBusinessProfile.mockRejectedValue(new Error("forbidden"));
    const html = await renderWebsite("footer");
    expect(html).toMatch(/<h2[^>]*>Footer<\/h2>/);
    expect(html).toContain("<footer");
    expect(html).toContain('aria-label="Report this site to CDS"');
    expect(html).toContain("Save footer");
    expect(html).toContain("© ");
    expect(html).not.toContain(SHELL_PANEL_BODY.replace("'", "&#x27;"));
  });

  // 07-29 (CONT-36): every chrome tab has a ghost History button in its heading row. The
  // Banner form mounts after hydration (browser zone), so its button and the click wiring
  // for all four tabs are covered in history-wiring.dom.test.tsx.
  it("?tab=navigation, footer and site render a History button in the heading row (07-29)", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    chromeMocks();
    db.getNav.mockResolvedValue(null);
    db.getFooter.mockResolvedValue(null);
    db.getBusinessProfile.mockRejectedValue(new Error("forbidden"));
    db.siteContextForHost.mockResolvedValue(null);
    siteCache.getConsentNeeds.mockResolvedValue({
      needed: false,
      frames: [],
      analytics: false,
    });
    const heading = {
      navigation: "Navigation",
      footer: "Footer",
      site: "Site settings",
    } as const;
    for (const tab of ["navigation", "footer", "site"] as const) {
      const html = await renderWebsite(tab);
      const row = html.match(
        new RegExp(`<h2[^>]*>${heading[tab]}</h2>[\\s\\S]*?</button>`),
      )?.[0];
      expect(row, tab).toBeDefined();
      expect(row).toContain("<span>History</span>");
      expect(row).not.toContain('type="submit"');
    }
  });

  it("?tab=navigation shows the Search switch, off by default (07-26)", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    chromeMocks();
    db.getNav.mockResolvedValue(null);
    const html = await renderWebsite("navigation");
    expect(html).toContain("Show a search button in the menu");
    const input = html.match(/<input[^>]*id="nav-show-search"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    expect(input).not.toContain(' checked=""');
    expect(html).not.toContain("Search this site");
    expect(db.getSiteSettings).toHaveBeenCalledWith(CTX);
  });

  it("?tab=navigation previews the search link when it is on (07-26)", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    chromeMocks();
    db.getNav.mockResolvedValue(null);
    db.getSiteSettings.mockResolvedValue({
      language: "en",
      show_translate: false,
      show_search: true,
      allow_ai_crawlers: true,
    });
    const html = await renderWebsite("navigation");
    expect(html).toMatch(/<input[^>]*id="nav-show-search"[^>]* checked=""/);
    expect(html).toContain('aria-label="Search this site"');
  });

  describe("?tab=site (07-26, CONT-29, D-UI-P7-3)", () => {
    function siteMocks(over: Record<string, unknown> = {}) {
      chromeMocks();
      db.getNav.mockResolvedValue(null);
      db.getSiteSettings.mockResolvedValue({
        language: "en",
        show_translate: false,
        show_search: false,
        allow_ai_crawlers: true,
        ...over,
      });
      db.siteContextForHost.mockResolvedValue({
        orgId: "org1",
        host: "palm.example",
      });
      siteCache.getConsentNeeds.mockResolvedValue({
        needed: true,
        frames: ["video", "map"],
        analytics: false,
      });
    }

    it("renders the heading, preview, three sections and the cookie line", async () => {
      signIn();
      db.activeAddons.mockResolvedValue([]);
      siteMocks();
      const html = await renderWebsite("site");
      expect(html).toMatch(/<a[^>]*href="\?tab=site"[^>]*aria-current="page"/);
      expect(html).toMatch(/<h2[^>]*>Site settings<\/h2>/);
      expect(html).toContain("Changes show on your site as soon as you save.");
      expect(html).toContain("data-site");
      expect(html).toContain("<header");
      expect(html).toMatch(/<h3[^>]*>Language<\/h3>/);
      expect(html).toMatch(/<h3[^>]*>Search engines and AI<\/h3>/);
      expect(html).toMatch(/<h3[^>]*>Cookie notice<\/h3>/);
      expect(html).toContain("Your site&#x27;s language");
      expect(html).toContain("Chinese (Simplified)");
      expect(html).toContain("Other…");
      expect(html).toContain("Show a Translate link");
      expect(html).toMatch(/<input[^>]*id="site-ai"[^>]* checked=""/);
      expect(html).toContain('href="https://palm.example/sitemap.xml"');
      expect(html).toContain("Your sitemap: palm.example/sitemap.xml");
      expect(html).toContain("Your site shows a cookie notice because");
      expect(html).toContain("Save settings");
      expect(html).not.toContain("data-cds-translate");
      expect(html).not.toContain(SHELL_PANEL_BODY.replace("'", "&#x27;"));
      expect(db.siteContextForHost).toHaveBeenCalledWith("palm.example");
      expect(db.addonRepo).not.toHaveBeenCalled();
    });

    it("a stored code outside the list preselects Other with the code filled", async () => {
      signIn();
      db.activeAddons.mockResolvedValue([]);
      siteMocks({ language: "pt-BR", show_translate: true });
      const html = await renderWebsite("site");
      expect(html).toMatch(/<option value="other" selected="">/);
      expect(html).toMatch(
        /id="site-language-other"[^>]*value="pt-BR"|value="pt-BR"[^>]*id="site-language-other"/,
      );
      expect(html).toContain("Language code");
      expect(html).toContain("data-cds-translate");
    });

    it("the cookie line falls back when it can't be checked", async () => {
      signIn();
      db.activeAddons.mockResolvedValue([]);
      siteMocks();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      siteCache.getConsentNeeds.mockRejectedValue(new Error("down"));
      const html = await renderWebsite("site");
      expect(html).toContain("We couldn&#x27;t check this right now.");
      log.mockRestore();
    });

    it("07-30: Sharing shows the generated icon and share image on both grounds", async () => {
      signIn();
      db.activeAddons.mockResolvedValue([]);
      siteMocks({ share_image: "" });
      db.readOwnSiteIcons.mockResolvedValue({
        v: "0123456789ab",
        source: "logo",
      });
      const html = await renderWebsite("site");
      expect(db.readOwnSiteIcons).toHaveBeenCalledWith(CTX);
      // WR-C06: a GET render never regenerates (no store writes); the mounted form does.
      expect(db.refreshSiteIcons).not.toHaveBeenCalled();
      expect(html).toMatch(/<h3[^>]*>Sharing<\/h3>/);
      expect(html).toContain(
        'src="https://palm.example/_site/icon-32.png?v=0123456789ab"',
      );
      expect(html).toContain(
        'src="https://palm.example/_site/share.png?v=0123456789ab"',
      );
      expect(html).toContain("background-color:#FFFFFF");
      expect(html).toContain("background-color:#1B1B19");
      expect(html).toContain("Made from your logo.");
      expect(html).toContain('href="/hub/settings?tab=business"');
      expect(html).toContain("Use a different share image");
      // UI-SPEC order: Search engines and AI, Sharing, Cookie notice.
      expect(html.indexOf(">Sharing<")).toBeGreaterThan(
        html.indexOf(">Search engines and AI<"),
      );
      expect(html.indexOf(">Cookie notice<")).toBeGreaterThan(
        html.indexOf(">Sharing<"),
      );
    });

    it("07-30: no icons yet (or a failed refresh) shows the address line", async () => {
      signIn();
      db.activeAddons.mockResolvedValue([]);
      siteMocks();
      db.readOwnSiteIcons.mockRejectedValue(new Error("down"));
      const html = await renderWebsite("site");
      expect(html).toContain(
        "Your site icon appears once your site has an address.",
      );
      expect(html).not.toContain("/_site/icon-32.png");
    });

    it("07-30: the share image is saved with only the changed keys", async () => {
      const { siteSettingsChanges } =
        await import("../app/(platform)/hub/website/SiteSettingsForm");
      const saved = {
        language: "en",
        show_translate: false,
        show_search: false,
        allow_ai_crawlers: false,
        share_image: "",
      };
      const draft = {
        choice: "en",
        other: "",
        show_translate: false,
        allow_ai_crawlers: false,
        share_image: "abc123def456ghi",
      };
      expect(siteSettingsChanges(saved, draft)).toEqual({
        patch: { share_image: "abc123def456ghi" },
        invalidLanguage: false,
      });
    });

    it("a failed load shows the Try again alert", async () => {
      signIn();
      db.activeAddons.mockResolvedValue([]);
      siteMocks();
      db.getSiteSettings.mockRejectedValue(new Error("pb down"));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const html = await renderWebsite("site");
      expect(html).toContain("couldn&#x27;t load this");
      expect(html).toContain('href="?tab=site"');
      log.mockRestore();
    });
  });

  it("a failed navigation load shows the Try again alert", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    chromeMocks();
    db.getNav.mockRejectedValue(new Error("pb down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await renderWebsite("navigation");
    expect(html).toContain("couldn&#x27;t load this");
    expect(html).toContain("Try again");
    log.mockRestore();
  });

  // 07-18 replaced the Forms shell: the tab streams its panel behind 3 skeleton rows.
  it("?tab=forms opens the Forms panel, never an add-on panel", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    const html = await renderWebsite("forms");
    expect(html).toMatch(/<a[^>]*href="\?tab=forms"[^>]*aria-current="page"/);
    expect(html.match(/data-skeleton-row/g)).toHaveLength(3);
    expect(html).not.toContain(SHELL_PANEL_BODY.replace("'", "&#x27;"));
    expect(db.addonRepo).not.toHaveBeenCalled();
  });
});

describe("page slug helpers", () => {
  it("matches the database slug rule", async () => {
    const { SLUG_RE } = await import("@cds/db");
    expect(SLUG_PATTERN.source).toBe(SLUG_RE.source);
  });

  it("slugifies a title", () => {
    expect(slugify("About Us")).toBe("about-us");
    expect(slugify("  Café & Bar!! ")).toBe("cafe-bar");
    expect(slugify("---")).toBe("");
  });

  it("gives the UI-SPEC copy for format, reserved and taken", () => {
    const opts = { reserved: ["hub", "api"], taken: ["about"] };
    expect(slugError("Our Story", opts)).toBe(
      "Use lowercase letters, numbers and hyphens, like /our-story.",
    );
    expect(slugError("hub", opts)).toBe(
      "/hub is used by the system. Pick another address.",
    );
    expect(slugError("about", opts)).toBe(
      "Another page already uses /about. Try /about-2.",
    );
    expect(slugError("our-story", opts)).toBeNull();
  });

  it("formats last published or a dash", () => {
    expect(formatLastPublished("2026-09-12 14:14:00.000Z")).toBe(
      "12 Sep, 2:14 pm",
    );
    expect(formatLastPublished(null)).toBe("—");
  });
});

describe("hub layout (T-03-42)", () => {
  it("redirects to /sign-in without a session", async () => {
    await expect(HubLayout({ children: <p>x</p> })).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
  });

  it("renders the D311 shell: name, View site, Website nav, profile menu", async () => {
    signIn();
    const html = renderToStaticMarkup(
      (await HubLayout({ children: <p>inner</p> })) as ReactElement,
    );
    expect(html).toContain("Palm Science");
    expect(html).toContain('href="https://palm.example"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("View site");
    expect(html).toMatch(
      /<a[^>]*href="\/hub\/website"[^>]*aria-current="page"/,
    );
    // 11-16 (D-UI-P11-5): the email and Sign out moved into the (closed) profile menu.
    expect(html).toContain("Your profile and sign out");
    expect(html).not.toContain("owner@palm.example");
    expect(html).toContain("Open menu");
    expect(html).toContain("Skip to content");
    expect(html).toContain("<p>inner</p>");
    // A&M fork: no "CDS Support" row, so the sidebar never names CDS.
    expect(html).not.toContain("CDS Support");
    expect(html).not.toMatch(/CDS|Connections Design/);
    // Owner: the pinned Get add-ons item (05-11, D311), not active on /hub/website.
    expect(html).toMatch(/<a[^>]*href="\/hub\/add-ons"[^>]*>.*Get add-ons/);
    expect(html).not.toMatch(/href="\/hub\/add-ons"[^>]*aria-current/);
  });

  it("marks Get add-ons active on /hub/add-ons and hides it from an editor (05-11)", async () => {
    signIn();
    state.pathname = "/hub/add-ons/testimonials";
    try {
      const html = renderToStaticMarkup(
        (await HubLayout({ children: null })) as ReactElement,
      );
      expect(html).toMatch(
        /<a[^>]*href="\/hub\/add-ons"[^>]*aria-current="page"/,
      );
      db.orgContextFromToken.mockResolvedValue({ ...CTX, role: "editor" });
      const editor = renderToStaticMarkup(
        (await HubLayout({ children: null })) as ReactElement,
      );
      expect(editor).not.toContain("Get add-ons");
      expect(editor).toContain('href="/hub/website"');
    } finally {
      state.pathname = "/hub/website";
    }
  });

  it("still renders when the add-on state can't be read", async () => {
    signIn();
    db.activeAddons.mockRejectedValueOnce(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(
      (await HubLayout({ children: null })) as ReactElement,
    );
    err.mockRestore();
    expect(html).toContain('href="/hub/website"');
  });

  it("hides View site when the site has no host yet", async () => {
    signIn();
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [{ ...ORG, primaryHost: null }],
    });
    const html = renderToStaticMarkup(
      (await HubLayout({ children: null })) as ReactElement,
    );
    expect(html).not.toContain("View site");
  });
});

describe("Website page, Pages tab (CONT-30)", () => {
  it("renders the H1, the tab bar and the page table with statuses", async () => {
    signIn();
    db.listPages.mockResolvedValue(PAGES);
    const html = await renderWebsite("pages");
    expect(db.listPages).toHaveBeenCalledWith(CTX);
    expect(html).toMatch(/<h1[^>]*>Website<\/h1>/);
    expect(html).toMatch(/<a[^>]*href="\?tab=pages"[^>]*aria-current="page"/);
    expect(html).toContain("<table");
    // Home first, with its badge.
    const home = html.indexOf('href="/hub/website/pages/p-home"');
    const about = html.indexOf('href="/hub/website/pages/p-about"');
    expect(home).toBeGreaterThan(-1);
    expect(home).toBeLessThan(about);
    expect(html).toContain(">Home</span>");
    expect(html).toContain("Unpublished changes");
    expect(html).toContain("In review");
    expect(html).toContain(">Draft</span>");
    expect(html).toContain("4 of 10 pages");
    expect(html).toContain("12 Sep, 2:14 pm");
    expect(html).toContain("—");
    expect(html).toContain("Add page");
  });

  it("shows Recently deleted below the table for content writers only (11-30)", async () => {
    signIn();
    db.listPages.mockResolvedValue(PAGES);
    db.listRecentlyDeleted.mockResolvedValue([
      {
        id: "p-team",
        title: "Our team",
        slug: "our-team",
        deletedAt: "2026-10-09 10:00:00.000Z",
        deletedBy: "Maria",
      },
    ]);
    const html = await renderWebsite("pages");
    expect(db.listRecentlyDeleted).toHaveBeenCalledWith(CTX);
    expect(html).toContain("Recently deleted (1)");
    expect(html).toContain('aria-label="More for About"');
    db.listRecentlyDeleted.mockClear();
    db.orgContextFromToken.mockResolvedValue({ ...CTX, role: "viewer" });
    const viewer = await renderWebsite("pages");
    expect(db.listRecentlyDeleted).not.toHaveBeenCalled();
    expect(viewer).not.toContain("Recently deleted");
  });

  it("a failed Recently deleted read hides the section, the tab still renders", async () => {
    signIn();
    db.listPages.mockResolvedValue(PAGES);
    db.listRecentlyDeleted.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await renderWebsite("pages");
    err.mockRestore();
    expect(html).toContain("<table");
    expect(html).not.toContain("Recently deleted");
  });

  it("shows / for home and /slug for other pages", async () => {
    signIn();
    db.listPages.mockResolvedValue(PAGES);
    const html = await renderWebsite();
    expect(html).toContain(">/</");
    expect(html).toContain(">/about</");
  });

  it("falls back to Pages for an unknown tab", async () => {
    signIn();
    db.listPages.mockResolvedValue(PAGES);
    const html = await renderWebsite("bogus");
    expect(html).toMatch(/<a[^>]*href="\?tab=pages"[^>]*aria-current="page"/);
  });

  it("renders EMPTY-1 for an empty list", async () => {
    signIn();
    db.listPages.mockResolvedValue([]);
    const html = await renderWebsite();
    expect(html).toContain("No pages yet");
    expect(html).toContain(
      "Add your first page. Start with Home, the page visitors see first.",
    );
    expect(html).not.toContain("<table");
  });

  it("shows ERR-LOAD with Try again when the list fails", async () => {
    signIn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.listPages.mockRejectedValue(new Error("ClientResponseError 500"));
    const html = await renderWebsite();
    spy.mockRestore();
    expect(html).toContain(
      "We couldn&#x27;t load this. Check your connection and try again.",
    );
    expect(html).toContain("Try again");
    expect(html).not.toContain("ClientResponseError");
  });
});

describe("page actions (T-03-42)", () => {
  it("createPageAction without a session is signed_out and never writes", async () => {
    const r = await createPageAction({ title: "About", slug: "about" });
    expect(r.ok === false && r.code).toBe("signed_out");
    expect(db.createPage).not.toHaveBeenCalled();
  });

  it("createPageAction passes only the cookie-derived ctx, title and slug", async () => {
    signIn();
    const created = page({ id: "new", slug: "about", title: "About" });
    db.createPage.mockResolvedValue(created);
    const r = await createPageAction({
      title: "About",
      slug: "about",
      organization: "evil",
    } as never);
    expect(db.createPage).toHaveBeenCalledWith(CTX, {
      title: "About",
      slug: "about",
    });
    expect(r).toEqual({ ok: true, data: { ...created, navAdded: false } });
    expect(db.addPageToNav).not.toHaveBeenCalled();
  });

  it("createPageAction maps SlugTaken to the slug field", async () => {
    signIn();
    const { SlugTaken } = (await import("@cds/db")) as unknown as {
      SlugTaken: new (m: string) => Error;
    };
    db.createPage.mockRejectedValue(
      new SlugTaken("Another page already uses /about. Try /about-2."),
    );
    const r = await createPageAction({ title: "About", slug: "about" });
    expect(r).toMatchObject({ ok: false, code: "slug_taken", field: "slug" });
  });

  it("createPageAction maps PageLimitReached to page_limit with the allowance (11-28)", async () => {
    signIn();
    const { PageLimitReached, pagesFullCopy } =
      await import("@cds/core/content");
    db.createPage.mockRejectedValue(new PageLimitReached(15));
    const r = await createPageAction({ title: "About", slug: "about" });
    expect(r).toEqual({
      ok: false,
      code: "page_limit",
      message: pagesFullCopy(15),
      allowance: 15,
    });
  });

  it("updatePageAction scopes to the session ctx", async () => {
    signIn();
    db.updatePage.mockResolvedValue(page({ id: "p1" }));
    await updatePageAction("p1", { title: "New" });
    expect(db.updatePage).toHaveBeenCalledWith(CTX, "p1", { title: "New" });
  });
  // 11-30 (T-11-30-01/02): ids and the redirect from the browser are only shape-checked;
  // @cds/db checks content:write and that the target is an own live page.
  it("pageDeleteCaseAction reads the case for the session ctx", async () => {
    signIn();
    db.pageDeleteCase.mockResolvedValue({ deletable: true });
    const r = await pageDeleteCaseAction("p-about");
    expect(db.pageDeleteCase).toHaveBeenCalledWith(CTX, "p-about");
    expect(r).toEqual({ ok: true, data: { deletable: true } });
  });

  it("deletePageAction passes the redirect and revalidates the hub", async () => {
    signIn();
    db.deletePage.mockResolvedValue({ id: "p-about", redirectTo: "home" });
    const r = await deletePageAction("p-about", "p-home");
    expect(db.deletePage).toHaveBeenCalledWith(
      CTX,
      "p-about",
      { redirectTo: "p-home" },
      expect.objectContaining({ invalidator: expect.anything() }),
    );
    expect(r.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/hub/website");
  });

  it("deletePageAction: no redirect (null, '' or junk) means page not found", async () => {
    signIn();
    db.deletePage.mockResolvedValue({ id: "p-about", redirectTo: null });
    for (const v of [null, "", 42]) {
      await deletePageAction("p-about", v as never);
      expect(db.deletePage).toHaveBeenLastCalledWith(
        CTX,
        "p-about",
        { redirectTo: null },
        expect.anything(),
      );
    }
  });

  it("deletePageAction without a session never deletes", async () => {
    const r = await deletePageAction("p-about", "p-home");
    expect(r.ok === false && r.code).toBe("signed_out");
    expect(db.deletePage).not.toHaveBeenCalled();
  });

  it("deletePageAction: a Viewer refusal is the forbidden copy, no revalidate", async () => {
    signIn();
    const { Forbidden } = await import("@cds/core");
    db.deletePage.mockRejectedValue(new Forbidden());
    const r = await deletePageAction("p-about", null);
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("restoreDeletedPageAction maps PageLimitReached to page_limit with the allowance", async () => {
    signIn();
    const { PageLimitReached, pagesFullCopy } =
      await import("@cds/core/content");
    db.restoreDeletedPage.mockRejectedValue(new PageLimitReached(10));
    const r = await restoreDeletedPageAction("p-about");
    expect(r).toEqual({
      ok: false,
      code: "page_limit",
      message: pagesFullCopy(10),
      allowance: 10,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("restoreDeletedPageAction maps SlugTaken and revalidates on success", async () => {
    signIn();
    const { SlugTaken } = (await import("@cds/db")) as unknown as {
      SlugTaken: new (m: string) => Error;
    };
    db.restoreDeletedPage.mockRejectedValueOnce(new SlugTaken("taken"));
    expect(await restoreDeletedPageAction("p-about")).toMatchObject({
      ok: false,
      code: "slug_taken",
    });
    db.restoreDeletedPage.mockResolvedValue({ id: "p-about", live: true });
    expect(await restoreDeletedPageAction("p-about")).toEqual({
      ok: true,
      data: { id: "p-about", live: true },
    });
    expect(db.restoreDeletedPage).toHaveBeenCalledWith(
      CTX,
      "p-about",
      expect.objectContaining({ invalidator: expect.anything() }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/hub/website");
  });
});

describe("hub loading and error states (03-UI-REVIEW Fix 3)", () => {
  it("the hub error boundary shows ERR-LOAD with Try again, never the error text", () => {
    const html = renderToStaticMarkup(
      <HubError
        error={new Error("ClientResponseError 500")}
        reset={() => {}}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "We couldn&#x27;t load this. Check your connection and try again.",
    );
    expect(html).toContain("Try again");
    expect(html).not.toContain("ClientResponseError");
  });

  it("pads itself on the full-width builder, not inside the standard frame", () => {
    state.pathname = "/hub/website/pages/p1";
    const builder = renderToStaticMarkup(
      <HubError error={new Error("x")} reset={() => {}} />,
    );
    expect(builder).toContain("px-4 py-6");
    state.pathname = "/hub/website";
    const standard = renderToStaticMarkup(
      <HubError error={new Error("x")} reset={() => {}} />,
    );
    expect(standard).not.toContain("px-4 py-6");
  });

  it("the builder loads as a builder: 3 block rows (56px) on the list pane", () => {
    const html = renderToStaticMarkup(<BuilderLoading />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Website");
    expect(html).toContain("lg:grid-cols-[360px_minmax(0,1fr)]");
    const list =
      /bg-hub-surface-2 p-4">(.*?)<\/div><\/div>/.exec(html)?.[1] ?? "";
    expect(list.match(/data-skeleton-row/g)).toHaveLength(3);
    expect(list).toContain("height:56px");
    expect(list).toContain("bg-hub-border");
  });

  it("the preview loads with the preview strip, not the pages list", () => {
    const html = renderToStaticMarkup(<PreviewLoading />);
    expect(html).toContain("Loading preview");
    expect(html).not.toContain("Website");
  });
});

// ---------------------------------------------------------------------------------------
// 05-12: installed add-on tabs under Website (ADDON-08, ADDON-11; CONTEXT A4-Q3; T-05-59).

const INSTALLED = [
  { slug: "testimonials", label: "Testimonials" },
  { slug: "credentials", label: "Credentials" },
];

const TESTIMONIAL = {
  id: "t1",
  organization: "org1",
  quote: "Gentle hands and a calm room.",
  author_name: "Maria Lopez",
  author_detail: "Owner, Rivera Bakery",
  rating: 5,
  featured: false,
  is_published: true,
  sort_order: 1,
  source: "manual",
  created: "2026-09-27 10:00:00.000Z",
  updated: "2026-09-27 10:00:00.000Z",
};

function addonRows(rows: Record<string, unknown>[], held: string[] = []) {
  const collection = vi.fn(() => ({
    list: vi.fn(async () => rows),
    openHolds: vi.fn(async () => held),
  }));
  db.addonRepo.mockReturnValue({ collection });
  return collection;
}

function tabLinks(html: string): string[] {
  return [...html.matchAll(/<a[^>]*href="\?tab=([^"]+)"/g)].map((m) => m[1]!);
}

describe("composeWebsiteTabs (one composed source, server-filtered)", () => {
  it("owner: core tabs then installed add-ons in the given (manifest) order", () => {
    const tabs = composeWebsiteTabs({
      core: WEBSITE_TABS,
      installed: INSTALLED,
      role: "owner",
      grants: [],
    });
    expect(tabs.map((t) => t.id)).toEqual([
      "pages",
      "services",
      "media",
      "forms",
      "navigation",
      "footer",
      "banner",
      "popups",
      "site",
      "testimonials",
      "credentials",
    ]);
  });

  it("editor without a grant: core only; with a grant: plus that add-on", () => {
    const base = { core: WEBSITE_TABS, installed: INSTALLED, role: "editor" };
    expect(
      composeWebsiteTabs({ ...base, role: "editor", grants: [] }).map(
        (t) => t.id,
      ),
    ).toEqual(CORE_IDS);
    expect(
      composeWebsiteTabs({
        ...base,
        role: "editor",
        grants: ["credentials"],
      }).map((t) => t.id),
    ).toEqual([...CORE_IDS, "credentials"]);
  });

  it("grant-only member sees exactly their add-on tab", () => {
    const tabs = composeWebsiteTabs({
      core: WEBSITE_TABS,
      installed: INSTALLED,
      role: "staff",
      grants: ["credentials", "not-installed"],
    });
    expect(tabs).toEqual([{ id: "credentials", label: "Credentials" }]);
  });

  it("resolveTab: a known-but-off add-on falls back with fallbackFrom", () => {
    expect(resolveTab("testimonials", WEBSITE_TABS, ["testimonials"])).toEqual({
      id: "pages",
      fallbackFrom: "testimonials",
    });
    expect(resolveTab("bogus", WEBSITE_TABS, ["testimonials"])).toEqual({
      id: "pages",
      fallbackFrom: null,
    });
    expect(resolveTab("x", [], [])).toEqual({ id: "", fallbackFrom: null });
  });

  it("recordView hides the org id and bookkeeping; groupsOf keeps first-seen order", () => {
    const view = recordView(TESTIMONIAL, new Set(["t1"]));
    expect(view.id).toBe("t1");
    expect(view.held).toBe(true);
    expect(view.values).not.toHaveProperty("organization");
    expect(view.values).not.toHaveProperty("id");
    expect(view.values).not.toHaveProperty("created");
    expect(view.values.quote).toBe(TESTIMONIAL.quote);
    const rows = [
      { id: "a", category: "Licenses" },
      { id: "b", category: " " },
      { id: "c", category: "Memberships" },
      { id: "d", category: "Licenses" },
    ];
    expect(groupsOf(rows, "category")).toEqual(["Licenses", "Memberships"]);
    expect(groupsOf(rows, undefined)).toBeUndefined();
  });
});

describe("Website page, add-on tabs (05-12)", () => {
  it("shows Testimonials and Credentials tabs only when active, in manifest order", async () => {
    signIn();
    db.listPages.mockResolvedValue(PAGES);
    db.activeAddons.mockResolvedValue([]);
    expect(tabLinks(await renderWebsite())).toEqual(CORE_IDS);
    db.activeAddons.mockResolvedValue(["credentials", "testimonials"]);
    expect(tabLinks(await renderWebsite())).toEqual([
      "pages",
      "services",
      "media",
      "forms",
      "navigation",
      "footer",
      "banner",
      "popups",
      "site",
      "testimonials",
      "credentials",
    ]);
  });

  it("renders the Testimonials panel from the chokepoint with the page line", async () => {
    signIn();
    db.activeAddons.mockResolvedValue(["testimonials"]);
    const collection = addonRows([TESTIMONIAL]);
    db.addonPageInfo.mockResolvedValue({ id: "p9", slug: "testimonials" });
    const html = await renderWebsite("testimonials");
    expect(db.addonRepo).toHaveBeenCalledWith(
      CTX,
      expect.anything(),
      "testimonials",
    );
    expect(collection).toHaveBeenCalledWith("testimonials");
    expect(db.addonPageInfo).toHaveBeenCalledWith(CTX, "testimonials");
    expect(html).toMatch(
      /<a[^>]*href="\?tab=testimonials"[^>]*aria-current="page"/,
    );
    expect(html).toContain("Gentle hands and a calm room.");
    expect(html).toContain("1 testimonial · 1 shown on your site");
    expect(html).toContain("Your Testimonials page: /testimonials");
    expect(html).toContain('href="https://palm.example/testimonials"');
    expect(html).toContain("How Testimonials works");
    expect(html).not.toContain("org1");
    expect(db.listPages).not.toHaveBeenCalled();
  });

  it("shows the three-starts empty state for an empty list", async () => {
    signIn();
    db.activeAddons.mockResolvedValue(["testimonials"]);
    addonRows([]);
    db.addonPageInfo.mockResolvedValue(null);
    const html = await renderWebsite("testimonials");
    expect(html).toContain("No testimonials yet");
    expect(html).toContain("Add your first testimonial");
    expect(html).toContain("Import from a spreadsheet");
    expect(html).toContain("How this works");
  });

  it("renders the Credentials panel with its held flag and page deleted line", async () => {
    signIn();
    db.activeAddons.mockResolvedValue(["credentials"]);
    addonRows(
      [
        {
          id: "c1",
          title: "Registered Nurse",
          issuer: "Texas Board of Nursing",
          category: "Licenses",
          is_published: true,
          sort_order: 1,
        },
      ],
      ["c1"],
    );
    db.addonPageInfo.mockResolvedValue({ deleted: true });
    const html = await renderWebsite("credentials");
    expect(html).toContain("Registered Nurse");
    expect(html).toContain("Your Credentials page was deleted.");
    expect(html).toContain("being reviewed");
  });

  it("a grant-only member sees exactly their add-on tab", async () => {
    signIn();
    db.orgContextFromToken.mockResolvedValue({
      ...CTX,
      role: "staff",
      grants: ["testimonials"],
    });
    db.activeAddons.mockResolvedValue(["credentials", "testimonials"]);
    addonRows([TESTIMONIAL]);
    db.addonPageInfo.mockResolvedValue(null);
    const html = await renderWebsite();
    expect(tabLinks(html)).toEqual(["testimonials"]);
    expect(html).toContain("Gentle hands and a calm room.");
    expect(db.listPages).not.toHaveBeenCalled();
    // A bookmarked core tab still lands on their add-on tab.
    const pages = await renderWebsite("pages");
    expect(tabLinks(pages)).toEqual(["testimonials"]);
    expect(db.listPages).not.toHaveBeenCalled();
  });

  it("a bookmarked tab of a removed add-on lands on Pages with the off notice", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    db.listPages.mockResolvedValue(PAGES);
    const html = await renderWebsite("testimonials");
    expect(html).toMatch(/<a[^>]*href="\?tab=pages"[^>]*aria-current="page"/);
    expect(html).toContain(
      "Testimonials is off. Add it back from Get add-ons to see your testimonials.",
    );
    expect(html).toContain('href="/hub/add-ons/testimonials"');
    expect(html).toContain("<table");
    expect(db.addonRepo).not.toHaveBeenCalled();
  });

  it("10-32: a bookmarked tab of a paused add-on says PAUSED-TAB, with Update card and pay for the Owner", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    db.pausedAddons.mockResolvedValueOnce(["testimonials"]);
    db.listPages.mockResolvedValue(PAGES);
    const html = await renderWebsite("testimonials");
    expect(html).toContain(
      "Testimonials is paused because payment stopped. Pay from Settings › Billing to see your testimonials again.",
    );
    expect(html).not.toContain("Testimonials is off.");
    expect(html).toMatch(
      /<a href="\/hub\/settings\/billing\/card"[^>]*>Update card and pay<\/a>/,
    );
    expect(html).toContain("<table");

    // An Editor reads the same words without the billing action.
    db.orgContextFromToken.mockResolvedValue({ ...CTX, role: "editor" });
    db.pausedAddons.mockResolvedValueOnce(["testimonials"]);
    const editor = await renderWebsite("testimonials");
    expect(editor).toContain("is paused because payment stopped");
    expect(editor).not.toContain("Update card and pay");
  });

  it("10-32: a failed paused read keeps the P5 off notice", async () => {
    signIn();
    db.activeAddons.mockResolvedValue([]);
    db.pausedAddons.mockRejectedValueOnce(new Error("down"));
    db.listPages.mockResolvedValue(PAGES);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await renderWebsite("testimonials");
    err.mockRestore();
    expect(html).toContain("Testimonials is off.");
  });

  it("an editor without a grant never loads an active add-on's tab and sees no off notice", async () => {
    signIn();
    db.orgContextFromToken.mockResolvedValue({ ...CTX, role: "editor" });
    db.activeAddons.mockResolvedValue(["testimonials"]);
    db.listPages.mockResolvedValue(PAGES);
    const html = await renderWebsite("testimonials");
    expect(tabLinks(html)).toEqual(CORE_IDS);
    expect(html).not.toContain("is off");
    expect(db.addonRepo).not.toHaveBeenCalled();
  });

  it("shows ERR-LOAD with Try again when the add-on list fails", async () => {
    signIn();
    db.activeAddons.mockResolvedValue(["testimonials"]);
    db.addonRepo.mockReturnValue({
      collection: () => ({
        list: vi.fn(async () => {
          throw new Error("ClientResponseError 500");
        }),
        openHolds: vi.fn(async () => []),
      }),
    });
    db.addonPageInfo.mockResolvedValue(null);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await renderWebsite("testimonials");
    spy.mockRestore();
    expect(html).toContain(
      "We couldn&#x27;t load this. Check your connection and try again.",
    );
    expect(html).toContain('href="?tab=testimonials"');
    expect(html).not.toContain("ClientResponseError");
  });
});
