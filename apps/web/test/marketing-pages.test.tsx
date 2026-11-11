// 15-13 (HUB-05, HUB-01; P15-P3, P15-P27; T-15-13-02, T-15-13-03): the hub's catalog reader
// and blade builders. Imports the shared marketing mocks first (P15-P27).
import {
  DEGRADED_VIEW,
  DEMO_URL,
  mockMarketingData,
  PUBLIC_VIEW,
  UNPRICED_CATALOG,
} from "./helpers/marketing-mocks";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarketingLayout from "../app/(platform)/(marketing)/layout";
import MarketingNotFound from "../app/(platform)/(marketing)/not-found";
import {
  addonBlades,
  addonPriceLines,
  demoSiteUrl,
  marketingCatalog,
  pathBlades,
} from "../lib/marketing-catalog";

const req = vi.hoisted(() => ({ path: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(req.path === null ? {} : { "x-cds-path": req.path }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
// next/font/local only runs under the Next compiler: stand-in class names.
vi.mock("../app/(platform)/(marketing)/fonts", () => ({
  anybody: { variable: "font-var-anybody" },
  hanken: { variable: "font-var-hanken" },
}));

async function renderLayout(path: string | null): Promise<string> {
  req.path = path;
  const el = await MarketingLayout({ children: <p>page body</p> });
  return renderToStaticMarkup(el as ReactElement);
}

const errors = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  mockMarketingData();
  errors.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const byslug = (slug: string) => PUBLIC_VIEW.find((e) => e.slug === slug)!;

describe("marketingCatalog", () => {
  it("returns the catalog, the view and the public slugs", async () => {
    const m = await marketingCatalog();
    expect(m.catalog).not.toBeNull();
    expect(m.view.map((e) => e.slug)).toEqual([
      "builder-pro",
      "credentials",
      "testimonials",
    ]);
    expect(m.degraded).toBe(false);
    expect([...m.publicSlugs]).toEqual([
      "builder-pro",
      "credentials",
      "testimonials",
    ]);
  });

  it("a throwing price read gives catalog null, never a throw, and logs the class name only", async () => {
    mockMarketingData({ catalog: null });
    const m = await marketingCatalog();
    expect(m.catalog).toBeNull();
    expect(m.view).toHaveLength(3);
    expect(errors).toHaveBeenCalledWith(
      "[marketing] catalog read failed:",
      "Error",
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain("catalog down");
  });

  it("a degraded listing read passes the fallback view through", async () => {
    mockMarketingData({ degraded: true });
    const m = await marketingCatalog();
    expect(m.degraded).toBe(true);
    expect(m.view.every((e) => !e.pickable)).toBe(true);
  });
});

describe("demoSiteUrl", () => {
  it("returns the demo link", async () => {
    expect(await demoSiteUrl()).toBe(DEMO_URL);
  });
  it("is null when the read fails", async () => {
    mockMarketingData({ demoUrl: "throw" });
    expect(await demoSiteUrl()).toBeNull();
  });
});

describe("addonPriceLines", () => {
  it("priced on both paths", async () => {
    const { catalog } = await marketingCatalog();
    expect(addonPriceLines(byslug("credentials"), catalog)).toEqual([
      "Standard · $9/mo",
      "Studio · $9/mo",
    ]);
  });

  it("included: a 0-cent row on the path reads Included (Builder Pro on Studio, D300)", async () => {
    const { catalog } = await marketingCatalog();
    expect(addonPriceLines(byslug("builder-pro"), catalog)).toEqual([
      "Standard · $12/mo",
      "Studio · Included",
    ]);
  });

  it("off-path and unpriced", async () => {
    const { catalog } = await marketingCatalog();
    expect(addonPriceLines(byslug("testimonials"), catalog)).toEqual([
      "Standard · Price coming soon",
      "Studio · Not on this path",
    ]);
  });

  it("an unpriced catalog reads Price coming soon on every on-path line", () => {
    expect(addonPriceLines(byslug("builder-pro"), UNPRICED_CATALOG)).toEqual([
      "Standard · Price coming soon",
      "Studio · Price coming soon",
    ]);
  });

  it("a failed catalog gives no lines (never wrong ones)", () => {
    expect(addonPriceLines(byslug("credentials"), null)).toEqual([]);
  });
});

describe("pathBlades", () => {
  it("Standard and Studio with the base monthly line, then Shop as a coming-soon outline", async () => {
    const { catalog } = await marketingCatalog();
    const blades = pathBlades(catalog);
    expect(blades.map((b) => [b.key, b.chip, b.href, b.priceLines])).toEqual([
      ["standard", "cobalt", "/standard", ["$39/mo"]],
      ["studio", "berry", "/studio", ["$79/mo"]],
      ["shop", "outline", null, []],
    ]);
    expect(blades[2]!.status).toBe("coming_soon");
  });

  it("unpriced plan rows read Price coming soon", () => {
    expect(pathBlades(UNPRICED_CATALOG)[0]!.priceLines).toEqual([
      "Price coming soon",
    ]);
  });

  it("a null catalog gives blades with no price lines", () => {
    const blades = pathBlades(null);
    expect(blades).toHaveLength(3);
    expect(blades.every((b) => b.priceLines.length === 0)).toBe(true);
  });
});

describe("addonBlades", () => {
  it("numbers, chips, links and Add targets for pickable entries", async () => {
    const { view, catalog } = await marketingCatalog();
    const blades = addonBlades(view, catalog);
    expect(blades.map((b) => [b.key, b.number, b.chip])).toEqual([
      ["builder-pro", "No. 01", "marigold"],
      ["credentials", "No. 02", "violet"],
      ["testimonials", "No. 03", "teal"],
    ]);
    expect(blades[0]).toMatchObject({
      href: "/add-ons/builder-pro",
      addHref: "/start?addon=builder-pro",
      status: "available",
      tagline: "Builder Pro tagline",
    });
  });

  it("filters by path (Studio drops a Standard-only add-on)", async () => {
    const { view, catalog } = await marketingCatalog();
    expect(
      addonBlades(view, catalog, { path: "studio" }).map((b) => b.key),
    ).toEqual(["builder-pro", "credentials"]);
  });

  it("the degraded view is all coming soon with no Add button", () => {
    const blades = addonBlades(DEGRADED_VIEW, null);
    expect(blades.every((b) => b.status === "coming_soon")).toBe(true);
    expect(blades.every((b) => b.addHref === null)).toBe(true);
    expect(blades.every((b) => b.priceLines.length === 0)).toBe(true);
  });
});

describe("marketing layout", () => {
  it("wraps the page in data-mk with both font variables, the hub marker, skip link, #main and footer", async () => {
    const html = await renderLayout("/pricing");
    // React 19 hoists the <meta> (to <head> in the app; to the front of static markup here).
    expect(html).toMatch(
      /^(<meta [^>]*>)?<div data-mk="" data-mk-field="card" class="font-var-anybody font-var-hanken /,
    );
    expect(html).toContain('<meta name="cds-surface" content="hub"/>');
    expect(html).toContain('href="#main"');
    expect(html).toContain('<main id="main" tabindex="-1"');
    expect(html).toContain("<p>page body</p>");
    expect(html).toContain('id="footer-nav"');
    expect(html).toContain(
      `© ${new Date().getUTCFullYear()} Connections Design Studios`,
    );
  });

  it("marks the current section from the path header", async () => {
    const html = await renderLayout("/add-ons/builder-pro?x=1");
    expect(html).toMatch(/href="\/add-ons" aria-current="page"/);
    expect(html.match(/aria-current="page"/g)?.length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("no section is current off the five sections or without the header", async () => {
    for (const p of ["/", "/about", "/studios", null]) {
      const html = await renderLayout(p);
      expect(html).not.toMatch(/<a [^>]*aria-current="page"/);
    }
  });

  it("renders no hub-/site- utility classes (D104)", async () => {
    const html = await renderLayout("/standard");
    const classes = [...html.matchAll(/class="([^"]*)"/g)]
      .map((m) => m[1])
      .join(" ");
    expect(classes).not.toMatch(/\b(hub|site)-[a-z0-9-]+/);
  });
});

describe("marketing not-found", () => {
  it("says we can't find that page and links home and to /add-ons", () => {
    const html = renderToStaticMarkup(<MarketingNotFound />);
    expect(html).toContain("We can&#x27;t find that page.");
    expect(html).toContain("It may have moved.");
    expect(html).toMatch(/href="\/"[^>]*>Go to the home page/);
    expect(html).toMatch(/href="\/add-ons"[^>]*>See all add-ons/);
  });
});
