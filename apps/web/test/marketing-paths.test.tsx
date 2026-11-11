// 15-16 (HUB-01, HUB-02, HUB-06; D209, D-UI-P15-25, A2-Q4; T-15-16-01, T-15-16-02): the
// Standard and Studio path pages. Imports the shared marketing mocks first (P15-P27).
import { DEMO_URL, mockMarketingData } from "./helpers/marketing-mocks";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathPage } from "../app/(platform)/(marketing)/_components/PathPage";
import StandardPage, {
  dynamic as standardDynamic,
  generateMetadata as standardMetadata,
} from "../app/(platform)/(marketing)/standard/page";
import StudioPage, {
  dynamic as studioDynamic,
  generateMetadata as studioMetadata,
} from "../app/(platform)/(marketing)/studio/page";

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.spyOn(console, "error").mockImplementation(() => {});

type PathKey = "standard" | "studio";

/** Render a route the way Next does: the page element, then its async PathPage. */
async function render(path: PathKey): Promise<string> {
  const page = (
    path === "studio" ? StudioPage() : StandardPage()
  ) as ReactElement<{
    path: PathKey;
  }>;
  expect(page.type).toBe(PathPage);
  expect(page.props.path).toBe(path);
  const el = await PathPage({ path: page.props.path });
  return renderToStaticMarkup(el as ReactElement);
}

const unescape = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

beforeEach(() => {
  mockMarketingData();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hub path pages", () => {
  it("are dynamic per request (no ISR)", () => {
    expect(standardDynamic).toBe("force-dynamic");
    expect(studioDynamic).toBe("force-dynamic");
  });

  it.each([
    ["standard", "Standard"],
    ["studio", "Studio"],
  ] as const)(
    "%s: one H1 equal to the path name and a CTA into /start",
    async (path, name) => {
      const html = await render(path);
      const h1s = html.match(/<h1[^>]*>([^<]*)<\/h1>/g) ?? [];
      expect(h1s).toHaveLength(1);
      expect(h1s[0]).toContain(`>${name}</h1>`);
      expect(html).toContain(`href="/start?path=${path}"`);
      expect(html).toContain(`Start on ${name}`);
    },
  );

  it("studio with a demo URL: See a live demo before the first H2", async () => {
    const html = await render("studio");
    const demo = html.indexOf(`href="${DEMO_URL}"`);
    const firstH2 = html.indexOf("<h2");
    expect(demo).toBeGreaterThan(0);
    expect(html).toContain("See a live demo");
    expect(demo).toBeLessThan(firstH2);
    expect(html.slice(demo - 200, demo + 300)).toContain('target="_blank"');
  });

  it("studio with no demo URL: no demo link", async () => {
    mockMarketingData({ demoUrl: null });
    const html = await render("studio");
    expect(html).not.toContain("See a live demo");
    expect(html).not.toContain(DEMO_URL);
  });

  it("standard never shows the demo link", async () => {
    const html = await render("standard");
    expect(html).not.toContain("See a live demo");
  });

  it("dev: studio carries the comparison and calculator preset to Studio; standard has neither", async () => {
    const studio = unescape(await render("studio"));
    expect(studio).toContain('id="how-they-make-their-money"');
    expect(studio).toContain("How they make their money, and how we don't");
    expect(studio).toContain('id="calculator"');
    expect(studio).toContain("DRAFT");
    const standard = unescape(await render("standard"));
    expect(standard).not.toContain("How they make their money");
    expect(standard).not.toContain('id="calculator"');
  });

  it("production with draft claims only: studio shows no comparison and no calculator", async () => {
    mockMarketingData({ production: true });
    const html = unescape(await render("studio"));
    expect(html).not.toContain('id="how-they-make-their-money"');
    expect(html).not.toContain("How they make their money");
    expect(html).not.toContain('id="calculator"');
    expect(html).not.toContain("What would you keep?");
    expect(html).not.toContain("DRAFT");
  });

  it.each(["standard", "studio"] as const)(
    "%s: no included line mentions booking unless tagged coming soon (D-UI-P15-25)",
    async (path) => {
      const html = await render(path);
      const lines = html.match(/<li data-mk-included="[^"]+"[\s\S]*?<\/li>/g);
      expect(lines?.length ?? 0).toBeGreaterThan(0);
      for (const li of lines ?? []) {
        if (/book|appointment|registration/i.test(li)) {
          expect(li).toContain('data-mk-included="soon"');
          expect(li).toContain("Coming soon");
        }
        if (li.includes('data-mk-included="soon"')) {
          expect(li).toContain("Coming soon");
        }
      }
    },
  );

  it("studio: unshipped included lines carry Coming soon", async () => {
    const html = await render("studio");
    expect(html).toMatch(
      /data-mk-included="soon"[\s\S]*?Newsletter included[\s\S]*?Coming soon/,
    );
  });

  it("lists only the add-ons on the path, with Add to my site", async () => {
    const studio = await render("studio");
    expect(studio).toContain("Add-ons on Studio");
    expect(studio).toContain('href="/start?addon=builder-pro"');
    expect(studio).not.toContain('href="/start?addon=testimonials"');
    const standard = await render("standard");
    expect(standard).toContain('href="/start?addon=testimonials"');
  });

  it("empty rack reads the no-add-ons line", async () => {
    mockMarketingData({ view: [] });
    const html = await render("standard");
    expect(html).toContain(
      "No add-ons for Standard yet. Your site already includes pages, hosting and support.",
    );
  });

  it("prints no price figures when the catalog read fails", async () => {
    mockMarketingData({ catalog: null });
    const html = await render("standard");
    expect(html).not.toMatch(/\$\d/);
  });

  it("Good to know links the Care Plan, cross-links the other path, closes with the CTA", async () => {
    const html = unescape(await render("standard"));
    expect(html).toContain('href="/pricing#care-plan"');
    expect(html).toContain("Support is included");
    expect(html).toContain('href="/studio"');
    expect(html).toContain("Run a team? See Studio");
    expect(html).toContain("Ready to start on Standard?");
    const studio = unescape(await render("studio"));
    expect(studio).toContain("Working on your own? See Standard");
  });

  it("metadata: path titles, apex canonical in production", async () => {
    const s = await standardMetadata();
    expect(s.title).toBe("Standard · Connections Design Studios");
    expect(s.alternates?.canonical).toBeUndefined();
    mockMarketingData({ production: true });
    const t = await studioMetadata();
    expect(t.title).toBe("Studio · Connections Design Studios");
    expect(String(t.alternates?.canonical)).toMatch(/\/studio$/);
  });
});
