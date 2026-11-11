// 15-22 choice 5 (A3-Q4, P15-P3, P15-P4; T-15-22-04): platform robots.txt and sitemap.xml.
// Imports the shared marketing mocks first (P15-P27); the view read is the mocked getCatalogView.
import { mockMarketingData, PUBLIC_VIEW } from "./helpers/marketing-mocks";
import { MARKETING_ROUTES } from "@cds/core/marketing";
import type { CatalogEntry } from "@cds/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCatalogView } from "../lib/catalog-view";
import * as robots from "../app/(platform)/robots.txt/route";
import * as sitemap from "../app/(platform)/sitemap.xml/route";

vi.spyOn(console, "error").mockImplementation(() => {});

const APEX = "https://connectionsdesignstudios.com";

beforeEach(() => {
  mockMarketingData();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const locs = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

describe("platform robots.txt (15-22 choice 3)", () => {
  it("is dynamic per request", () => {
    expect(robots.dynamic).toBe("force-dynamic");
  });

  it("disallows everything outside production", async () => {
    mockMarketingData({ production: false });
    const res = robots.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("production disallows the private areas and names the sitemap", async () => {
    mockMarketingData({ production: true });
    expect(await robots.GET().text()).toBe(
      "User-agent: *\nDisallow: /staff\nDisallow: /hub\nDisallow: /start/q/\nSitemap: https://connectionsdesignstudios.com/sitemap.xml\n",
    );
  });

  it("WR-A02: /report stays crawlable so its noindex is seen", async () => {
    mockMarketingData({ production: true });
    expect(await robots.GET().text()).not.toContain("/report");
  });
});

describe("platform sitemap.xml (15-22 choice 4)", () => {
  it("is dynamic on the Node runtime", () => {
    expect(sitemap.dynamic).toBe("force-dynamic");
    expect(sitemap.runtime).toBe("nodejs");
  });

  it("lists every indexed marketing route and each public add-on on the apex", async () => {
    const res = await sitemap.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const urls = locs(xml);
    for (const r of MARKETING_ROUTES.filter((x) => x.sitemap)) {
      expect(urls, r.path).toContain(
        r.path === "/" ? `${APEX}/` : `${APEX}${r.path}`,
      );
    }
    for (const p of [
      "/standard",
      "/studio",
      "/add-ons",
      "/independent-pros",
      "/hosting-rules",
    ]) {
      expect(urls, p).toContain(`${APEX}${p}`);
    }
    for (const e of PUBLIC_VIEW) {
      expect(urls, e.slug).toContain(`${APEX}/add-ons/${e.slug}`);
    }
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("never lists /report, /unsubscribe or a private add-on", async () => {
    const priv: CatalogEntry = {
      ...PUBLIC_VIEW[0]!,
      slug: "secret-addon",
      private: true,
    };
    mockMarketingData({ view: [...PUBLIC_VIEW, priv] });
    const xml = await (await sitemap.GET()).text();
    expect(xml).not.toContain("/report");
    expect(xml).not.toContain("/unsubscribe");
    expect(xml).not.toContain("secret-addon");
  });

  it("uses the apex in production too (never the request origin)", async () => {
    mockMarketingData({ production: true });
    const urls = locs(await (await sitemap.GET()).text());
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith(`${APEX}/`), u).toBe(true);
  });

  it("answers 200 with the routes only when the view read throws", async () => {
    vi.mocked(getCatalogView).mockRejectedValueOnce(new TypeError("down"));
    const res = await sitemap.GET();
    expect(res.status).toBe(200);
    const urls = locs(await res.text());
    expect(urls).toContain(`${APEX}/pricing`);
    expect(urls.some((u) => u?.includes("/add-ons/"))).toBe(false);
  });
});
