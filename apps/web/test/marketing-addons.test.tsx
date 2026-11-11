// 15-17 (HUB-01, HUB-02, HUB-05; A1-Q1, P15-P3, P15-P9; T-15-17-01..03): the /add-ons showcase
// and /add-ons/[slug] detail. Imports the shared marketing mocks first (P15-P27).
import {
  DEGRADED_VIEW,
  mockMarketingData,
  PUBLIC_VIEW,
} from "./helpers/marketing-mocks";
import type { CatalogEntry } from "@cds/db";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as listModule from "../app/(platform)/(marketing)/add-ons/page";
import * as detailModule from "../app/(platform)/(marketing)/add-ons/[slug]/page";
import AddonNotFound from "../app/(platform)/(marketing)/add-ons/[slug]/not-found";

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), {
      digest: "NEXT_NOT_FOUND",
    });
  }),
}));
vi.mock("next/navigation", () => ({ notFound: nav.notFound }));

vi.spyOn(console, "error").mockImplementation(() => {});

const AddonsPage = listModule.default;
const AddonDetailPage = detailModule.default;

async function renderList(path?: string | string[]): Promise<string> {
  const el = await AddonsPage({
    searchParams: Promise.resolve(path === undefined ? {} : { path }),
  });
  return renderToStaticMarkup(el as ReactElement);
}

async function renderDetail(slug: string): Promise<string> {
  const el = await AddonDetailPage({ params: Promise.resolve({ slug }) });
  return renderToStaticMarkup(el as ReactElement);
}

const addHrefs = (html: string) =>
  [...html.matchAll(/href="(\/start\?addon=[^"]+)"/g)].map((m) => m[1]);

const unescape = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

beforeEach(() => {
  nav.notFound.mockClear();
  mockMarketingData();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/add-ons showcase", () => {
  it("is dynamic per request with no static params (P15-P3)", () => {
    expect(listModule.dynamic).toBe("force-dynamic");
    expect(detailModule.dynamic).toBe("force-dynamic");
    expect("generateStaticParams" in detailModule).toBe(false);
    expect("revalidate" in detailModule).toBe(false);
    expect("revalidate" in listModule).toBe(false);
  });

  it("lists the public view in order with Add to my site -> /start?addon=<slug>", async () => {
    const html = await renderList();
    expect(html).toMatch(/<h1[^>]*>Add-ons<\/h1>/);
    expect(addHrefs(html)).toEqual([
      "/start?addon=builder-pro",
      "/start?addon=credentials",
      "/start?addon=testimonials",
    ]);
    const a = html.indexOf(">Builder Pro<");
    const b = html.indexOf(">Credentials<");
    const c = html.indexOf(">Testimonials<");
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(html).toContain('href="/add-ons/builder-pro"');
  });

  it("prints per-path price runs from the catalog; off-path reads Not on this path under All", async () => {
    const html = await renderList();
    expect(html).toContain("Standard · $12/mo");
    expect(html).toContain("Studio · Included");
    // Testimonials is Standard only: under All its Studio line reads Not on this path.
    const t = html.slice(html.indexOf(">Testimonials<"));
    expect(t).toContain("Studio · ");
    expect(t).toContain("Not on this path");
  });

  it("filter tabs are links with aria-current on the active one", async () => {
    const html = await renderList();
    expect(html).toMatch(/<a[^>]*href="\/add-ons"[^>]*aria-current="page"/);
    expect(html).toContain('href="/add-ons?path=standard"');
    expect(html).toContain('href="/add-ons?path=studio"');
  });

  it("?path=studio filters out Standard-only add-ons", async () => {
    const html = await renderList("studio");
    expect(addHrefs(html)).toEqual([
      "/start?addon=builder-pro",
      "/start?addon=credentials",
    ]);
    expect(html).not.toContain(">Testimonials<");
    expect(html).toMatch(
      /<a[^>]*href="\/add-ons\?path=studio"[^>]*aria-current="page"/,
    );
  });

  it("an unknown or repeated path reads as All", async () => {
    for (const p of ["shop", ["studio", "standard"], "__proto__"]) {
      const html = await renderList(p);
      expect(addHrefs(html)).toHaveLength(3);
      expect(html).toMatch(/<a[^>]*href="\/add-ons"[^>]*aria-current="page"/);
    }
  });

  it("a coming-soon add-on shows the tag and no Add button", async () => {
    const view: CatalogEntry[] = PUBLIC_VIEW.map((e) =>
      e.slug === "credentials"
        ? { ...e, availability: "coming_soon", pickable: false }
        : e,
    );
    mockMarketingData({ view });
    const html = await renderList();
    expect(addHrefs(html)).toEqual([
      "/start?addon=builder-pro",
      "/start?addon=testimonials",
    ]);
    expect(html).toContain("Credentials");
    expect(html).toContain("Coming soon");
  });

  it("degraded catalog: blades present, no Add buttons, never empty", async () => {
    mockMarketingData({ degraded: true });
    const html = await renderList();
    expect(addHrefs(html)).toEqual([]);
    for (const e of DEGRADED_VIEW) expect(html).toContain(e.name);
    expect(html).not.toContain("Add-ons are on their way.");
  });

  it("empty view shows the empty state with Start your site", async () => {
    mockMarketingData({ view: [] });
    const html = await renderList();
    expect(html).toContain("Add-ons are on their way.");
    expect(html).toContain('href="/start"');
    expect(html).toContain("Start your site");
  });

  it("closes with Ask a question and Start your site", async () => {
    const html = await renderList();
    expect(html).toContain("Not sure what you need?");
    expect(html).toContain('href="/contact?topic=question"');
    expect(html).toContain("Ask a question");
  });
});

describe("/add-ons/[slug] detail", () => {
  const SHOTS: CatalogEntry["screenshots"] = [
    {
      id: "a1",
      url: "/_catalog/builder-pro/a1.png",
      alt: "Form",
      w: 1600,
      h: 1000,
    },
    {
      id: "a2",
      url: "/_catalog/builder-pro/a2.png",
      alt: "Table",
      w: 800,
      h: 500,
    },
  ];

  it("renders the band, H1, price runs, Add to my site and Works on", async () => {
    const html = await renderDetail("builder-pro");
    const h1s = html.match(/<h1[^>]*>([^<]*)<\/h1>/g) ?? [];
    expect(h1s).toEqual([expect.stringContaining(">Builder Pro</h1>")]);
    expect(html).toContain('data-mk-field="marigold"');
    expect(html).toContain("No. 01");
    expect(html).toContain("Builder Pro tagline");
    expect(html).toContain("Standard · $12/mo");
    expect(html).toContain("Studio · Included");
    expect(html).toContain('href="/start?addon=builder-pro"');
    expect(html).toContain("Add to my site");
    expect(html).toContain("Works on Standard and Studio");
    expect(html).toContain('href="/add-ons"');
  });

  it("shows 3 more add-ons, never itself", async () => {
    const view: CatalogEntry[] = [
      ...PUBLIC_VIEW,
      { ...PUBLIC_VIEW[0]!, slug: "newsletter", name: "Newsletter" },
      { ...PUBLIC_VIEW[0]!, slug: "events", name: "Events" },
    ];
    mockMarketingData({ view });
    const html = await renderDetail("credentials");
    const more = [...html.matchAll(/href="\/add-ons\/([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(more).toEqual(["builder-pro", "testimonials", "newsletter"]);
  });

  it("renders screenshots as plain <img> with width/height, lazy", async () => {
    const view = PUBLIC_VIEW.map((e) =>
      e.slug === "builder-pro" ? { ...e, screenshots: SHOTS } : e,
    );
    mockMarketingData({ view });
    const html = await renderDetail("builder-pro");
    const imgs = html.match(/<img [^>]*>/g) ?? [];
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toContain('src="/_catalog/builder-pro/a1.png"');
    expect(imgs[0]).toContain('width="1600"');
    expect(imgs[0]).toContain('height="1000"');
    expect(imgs[0]).toContain('alt="Form"');
    for (const img of imgs) {
      expect(img).toContain('loading="lazy"');
      expect(img).toContain('decoding="async"');
    }
    expect(html).toContain("<figure");
  });

  it("omits the screenshots section when there are none", async () => {
    const html = await renderDetail("builder-pro");
    expect(html).not.toContain("<img");
  });

  it("description renders as plain-text paragraphs (no HTML injection)", async () => {
    const view = PUBLIC_VIEW.map((e) =>
      e.slug === "builder-pro"
        ? {
            ...e,
            description: "First part.\n\n<script>alert(1)</script>\n\n\nThird.",
          }
        : e,
    );
    mockMarketingData({ view });
    const html = await renderDetail("builder-pro");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toMatch(/<p[^>]*>First part\.<\/p>/);
    expect(html).toMatch(/<p[^>]*>Third\.<\/p>/);
  });

  it("coming soon: tag + Ask about it, no Add button", async () => {
    const view: CatalogEntry[] = PUBLIC_VIEW.map((e) =>
      e.slug === "testimonials"
        ? { ...e, availability: "coming_soon", pickable: false }
        : e,
    );
    mockMarketingData({ view });
    const html = await renderDetail("testimonials");
    expect(unescape(html)).toContain(
      'href="/contact?topic=question&about=testimonials"',
    );
    expect(html).toContain("Ask about it");
    expect(html).toContain("Coming soon");
    expect(html).not.toContain('href="/start?addon=testimonials"');
    expect(html).toContain("Standard only");
  });

  it.each(["no-such-addon", "staff-notes", "__proto__", "constructor"])(
    "unknown, hidden or private slug %s is a 404",
    async (slug) => {
      await expect(renderDetail(slug)).rejects.toMatchObject({
        digest: "NEXT_NOT_FOUND",
      });
      expect(nav.notFound).toHaveBeenCalled();
    },
  );

  it("a private entry that leaks into the view is still a 404", async () => {
    mockMarketingData({
      view: [
        ...PUBLIC_VIEW,
        { ...PUBLIC_VIEW[0]!, slug: "secret", private: true },
      ],
    });
    await expect(renderDetail("secret")).rejects.toMatchObject({
      digest: "NEXT_NOT_FOUND",
    });
  });

  it("metadata: '<Name> · CDS add-on', tagline description, noindex off production", async () => {
    const meta = await detailModule.generateMetadata({
      params: Promise.resolve({ slug: "builder-pro" }),
    });
    expect(meta.title).toBe("Builder Pro · CDS add-on");
    expect(meta.description).toBe("Builder Pro tagline");
    expect(meta.robots).toEqual({ index: false, follow: false });
    mockMarketingData({ production: true });
    const prod = await detailModule.generateMetadata({
      params: Promise.resolve({ slug: "builder-pro" }),
    });
    expect(prod.alternates?.canonical).toBe(
      "https://connectionsdesignstudios.com/add-ons/builder-pro",
    );
  });

  it("not-found uses the add-on wording", () => {
    const html = renderToStaticMarkup(<AddonNotFound />);
    expect(unescape(html)).toContain("We can't find that add-on.");
    expect(html).toContain("It may have been renamed or retired.");
    expect(html).toContain('href="/add-ons"');
    expect(html).toContain("See all add-ons");
  });
});
