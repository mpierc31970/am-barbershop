// Site row + section + page rendering contract (CONT-03, CONT-04, D31, invariants 6 and 7;
// 03-UI-SPEC "Site rendering contract", "Heading-level rule"). Ported from donor
// predefined-block-grids.test.ts and seo-headings-alt.test.ts, rewritten as render tests:
// renderToStaticMarkup in the node unit project, no jsdom.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ALL_LAYOUTS,
  CORE_SECTIONS,
  composeSectionRegistry,
  headingOwnerId,
  type PublishedPage,
  type PublishedSection,
  type RowLayout,
} from "@cds/core/content";
import { PageRenderer } from "./PageRenderer";
import { RowRenderer } from "./RowRenderer";
import { CORE_SECTION_COMPONENTS, SectionRenderer } from "./SectionRenderer";
import { renderableSections } from "./renderable";

const html = (node: ReactElement) => renderToStaticMarkup(node);
const registry = composeSectionRegistry(CORE_SECTIONS, []);
const NOW = new Date("2026-10-01T12:00:00.000Z");

// The CONT-03 grid contract, one row per layout (donor RowRenderer layoutClasses).
const GRID: Record<RowLayout, string | null> = {
  full: null,
  "50-50": "md:grid-cols-2",
  "25-75": "md:grid-cols-[1fr_3fr]",
  "75-25": "md:grid-cols-[3fr_1fr]",
  "40-60": "md:grid-cols-[2fr_3fr]",
  "60-40": "md:grid-cols-[3fr_2fr]",
  "30-70": "md:grid-cols-[3fr_7fr]",
  "70-30": "md:grid-cols-[7fr_3fr]",
  "33-33-33": "md:grid-cols-3",
  "25-50-25": "md:grid-cols-[1fr_2fr_1fr]",
  "25-25-25-25": "sm:grid-cols-2 md:grid-cols-4",
  "20-20-20-20-20": "sm:grid-cols-2 md:grid-cols-5",
};

function section(
  over: Partial<PublishedSection> & { section_type: string; content: unknown },
): PublishedSection {
  return {
    id: over.id ?? `s-${over.section_type}`,
    row_layout: "full",
    settings: { background_variant: "main" },
    ...over,
  } as PublishedSection;
}

function page(sections: PublishedSection[]): PublishedPage {
  return {
    version: 1,
    page: {
      id: "p1",
      slug: "home",
      title: "Home",
      seo: {},
      password_protected: false,
    },
    sections,
    published_at: NOW.toISOString(),
  };
}

const hero = (over: Record<string, unknown> = {}) => ({
  tagline: "SECRET TAGLINE",
  heading: "Calm hands",
  heading_accent: "clear mind",
  subtitle: "Massage in the old town.",
  cta_primary_text: "Book now",
  cta_primary_link: "/book",
  cta_secondary_text: "Our work",
  cta_secondary_link: "/work",
  trust_text: "Licensed since 2004",
  image_url: "https://img.example/hero.jpg",
  image_alt: "Treatment room",
  ...over,
});

describe("RowRenderer grid contract (CONT-03)", () => {
  it.each(ALL_LAYOUTS.map((l) => [l]))(
    "%s renders its donor grid",
    (layout) => {
      const out = html(
        <RowRenderer layout={layout} background="main">
          <div>a</div>
        </RowRenderer>,
      );
      const expected = GRID[layout];
      if (expected === null) {
        expect(out).not.toContain("grid-cols");
      } else {
        expect(out).toContain(expected);
        expect(out).toContain("grid-cols-1");
        expect(out).toContain("gap-8");
      }
    },
  );

  it("covers every layout in the contract table", () => {
    expect(Object.keys(GRID).sort()).toEqual([...ALL_LAYOUTS].sort());
  });

  it("draws a band with padding-y 48/64px and a 1120px container with 24/32px sides", () => {
    const out = html(
      <RowRenderer layout="full" background="main">
        x
      </RowRenderer>,
    );
    expect(out).toMatch(/^<section/);
    expect(out).toContain("py-12");
    expect(out).toContain("md:py-16");
    expect(out).toContain("max-w-[1120px]");
    expect(out).toContain("px-6");
    expect(out).toContain("md:px-8");
  });

  it("main uses the site ground, alternate the alternate band", () => {
    const main = html(
      <RowRenderer layout="full" background="main">
        x
      </RowRenderer>,
    );
    const alt = html(
      <RowRenderer layout="full" background="alternate">
        x
      </RowRenderer>,
    );
    expect(main).toContain("bg-site-surface");
    expect(main).not.toContain("bg-site-surface-raised");
    expect(alt).toContain("bg-site-surface-raised");
  });

  it("never emits an inline style", () => {
    const out = html(
      <RowRenderer layout="50-50" background="alternate">
        x
      </RowRenderer>,
    );
    expect(out).not.toContain("style=");
  });
});

describe("SectionRenderer (registry dispatch, clamp on read)", () => {
  it("clamps a hero stored at 50-50 to full width", () => {
    const out = html(
      <SectionRenderer
        section={section({
          section_type: "hero",
          row_layout: "50-50",
          content: hero({ image_url: "" }),
        })}
        registry={registry}
        isH1Owner
        isFirst
        now={NOW}
      />,
    );
    expect(out).not.toContain("md:grid-cols-2");
  });

  it("honours a columns block's 50-50 split", () => {
    const out = html(
      <SectionRenderer
        section={section({
          section_type: "columns",
          row_layout: "50-50",
          content: { columns: [] },
        })}
        registry={registry}
        isH1Owner={false}
        isFirst={false}
        now={NOW}
      />,
    );
    expect(out).toContain("md:grid-cols-2");
  });

  it("ignores raw styling settings (invariant 7)", () => {
    const s = section({
      section_type: "text-only",
      content: { heading: "Hi", text: "<p>x</p>" },
    });
    (s as { settings: unknown }).settings = {
      background_variant: "alternate",
      bg_color: "#f00",
      text_color: "#0f0",
      css_class: "evil",
      padding_y: "xl",
      max_width: "max-w-none",
    };
    const out = html(
      <SectionRenderer
        section={s}
        registry={registry}
        isH1Owner={false}
        isFirst={false}
        now={NOW}
      />,
    );
    expect(out).not.toContain("#f00");
    expect(out).not.toContain("#0f0");
    expect(out).not.toContain("evil");
    expect(out).not.toContain("max-w-none");
    expect(out).not.toContain("py-20");
    expect(out).toContain("bg-site-surface-raised");
  });

  it("renders nothing for an unregistered section type, without throwing", () => {
    const out = html(
      <SectionRenderer
        section={section({ section_type: "booking-widget", content: {} })}
        registry={registry}
        isH1Owner={false}
        isFirst={false}
        now={NOW}
      />,
    );
    expect(out).toBe("");
  });

  it("renders nothing for a registered add-on type with no core component", () => {
    const withAddon = composeSectionRegistry(CORE_SECTIONS, [
      { ...CORE_SECTIONS[3]!, type: "fixture-addon", label: "Fixture" },
    ]);
    const out = html(
      <SectionRenderer
        section={section({ section_type: "fixture-addon", content: {} })}
        registry={withAddon}
        isH1Owner={false}
        isFirst={false}
        now={NOW}
      />,
    );
    expect(out).toBe("");
  });

  it("maps the five base core section types (P7 groups add more, 07-05)", () => {
    expect(Object.keys(CORE_SECTION_COMPONENTS)).toEqual(
      expect.arrayContaining([
        "columns",
        "cta-banner",
        "hero",
        "text-image",
        "text-only",
      ]),
    );
  });
});

describe("Hero (UI-SPEC Hero, D-UI-6)", () => {
  const render = (content: unknown, isH1Owner = true, isFirst = true) =>
    html(
      <SectionRenderer
        section={section({ section_type: "hero", content })}
        registry={registry}
        isH1Owner={isH1Owner}
        isFirst={isFirst}
        now={NOW}
      />,
    );

  it("renders heading_accent in an accent span and never the tagline", () => {
    const out = render(hero());
    expect(out).toMatch(
      /<span class="[^"]*text-site-accent[^"]*">clear mind<\/span>/,
    );
    expect(out).not.toContain("SECRET TAGLINE");
  });

  it("owns its own two-column split only when it has an image", () => {
    expect(render(hero())).toContain("md:grid-cols-2");
    expect(render(hero({ image_url: "" }))).not.toContain("md:grid-cols-2");
  });

  it("renders h2 when it does not own the page h1", () => {
    const out = render(hero(), false, false);
    expect(out).not.toContain("<h1");
    expect(out).toContain("<h2");
  });

  it("renders both buttons, the trust line and no donor placeholder copy", () => {
    const out = render(hero());
    expect(out).toContain('href="/book"');
    expect(out).toContain('href="/work"');
    expect(out).toContain("Licensed since 2004");
    const empty = render({ heading: "Only a heading" });
    expect(empty).not.toContain("Book a Session");
    expect(empty).not.toContain("Deborah");
  });

  it("uses the owner's alt, and an empty (decorative) alt, never the heading, without one", () => {
    expect(render(hero({ image_alt: "Deborah at work" }))).toContain(
      'alt="Deborah at work"',
    );
    const out = render(hero({ image_alt: "" }));
    expect(out).toContain('alt=""');
    expect(out).not.toMatch(/alt="[^"]+"/);
  });

  it("lazy-loads its image when it is not the first block", () => {
    const out = render(hero(), false, false);
    expect(out).toContain('loading="lazy"');
    expect(out).not.toMatch(/fetchpriority/i);
  });
});

describe("Text & image, Text, Call to action", () => {
  const render = (type: string, content: unknown) =>
    html(
      <SectionRenderer
        section={section({ section_type: type, content })}
        registry={registry}
        isH1Owner={false}
        isFirst={false}
        now={NOW}
      />,
    );

  it("text-image renders sanitized rich text in .site-prose and falls back alt to the heading", () => {
    const out = render("text-image", {
      heading: "Our room",
      text: "<p>Warm<script>x()</script></p>",
      image_url: "https://img.example/a.jpg",
      image_alt: "",
      list_items: ["One", "Two"],
      quote: "Lovely",
      cta_text: "Visit",
      cta_link: "/visit",
      phone: "+1 555 0100",
    });
    expect(out).toContain('class="site-prose');
    expect(out).toContain("<p>Warm</p>");
    expect(out).not.toContain("script");
    expect(out).toContain('alt="Our room"');
    expect(out).toContain("<li");
    expect(out).toContain("<blockquote");
    expect(out).toContain('href="tel:+15550100"');
  });

  it("text-only renders its heading as h2 and rich text as HTML, not escaped text", () => {
    const out = render("text-only", {
      heading: "About",
      text: "<p><strong>Hi</strong></p>",
    });
    expect(out).toContain("<h2");
    expect(out).toContain("<strong>Hi</strong>");
    expect(out).not.toContain("&lt;p&gt;");
  });

  it("cta-banner centers heading, description and one primary button", () => {
    const out = render("cta-banner", {
      heading: "Ready?",
      description: "Come in.",
      button_text: "Book",
      button_link: "https://book.example/",
    });
    expect(out).toContain("text-center");
    expect(out).toContain("Ready?");
    expect(out).toContain('href="https://book.example/"');
    expect(out.match(/<a /g)?.length).toBe(1);
  });
});

describe("PageRenderer (heading ownership, first-block image)", () => {
  it('renders <main id="content"> with exactly one h1 and the rest h2', () => {
    const out = html(
      <PageRenderer
        page={page([
          section({ id: "a", section_type: "hero", content: hero() }),
          section({
            id: "b",
            section_type: "text-only",
            content: { heading: "Second", text: "" },
          }),
          section({ id: "c", section_type: "hero", content: hero() }),
        ])}
        registry={registry}
        now={NOW}
      />,
    );
    // React 19 hoists a <link rel="preload"> for the eager image ahead of the tree.
    expect(out.replace(/^(<link[^>]*>)+/, "")).toMatch(/^<main id="content"/);
    expect(out.match(/<h1/g)?.length).toBe(1);
    expect(out.match(/<h2/g)?.length).toBe(2);
  });

  it("keeps a columns block's heading item h2 even when first; the hero owns the h1 (CONT-35)", () => {
    const out = html(
      <PageRenderer
        page={page([
          section({
            id: "a",
            section_type: "columns",
            content: {
              columns: [
                {
                  id: "c1",
                  items: [
                    { id: "i1", kind: "heading", text: "Welcome", level: 2 },
                    { id: "i2", kind: "heading", text: "Sub", level: 2 },
                  ],
                },
              ],
            },
          }),
          section({ id: "b", section_type: "hero", content: hero() }),
        ])}
        registry={registry}
        now={NOW}
      />,
    );
    expect(out).toMatch(/<h2[^>]*>Welcome<\/h2>/);
    expect(out.match(/<h1/g)?.length).toBe(1);
  });

  it("loads the first block's image eagerly with high fetch priority", () => {
    const out = html(
      <PageRenderer
        page={page([
          section({ id: "a", section_type: "hero", content: hero() }),
          section({
            id: "b",
            section_type: "text-image",
            content: {
              heading: "x",
              image_url: "https://img.example/b.jpg",
              image_alt: "b",
            },
          }),
        ])}
        registry={registry}
        now={NOW}
      />,
    );
    const imgs = out.match(/<img[^>]*>/g) ?? [];
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toContain('loading="eager"');
    expect(imgs[0]).toMatch(/fetchpriority="high"/i);
    expect(imgs[1]).toContain('loading="lazy"');
  });

  it("passes the openable pop-ups down: a button for any other pop-up is dropped (WR-C07)", () => {
    const button = (id: string, popup_id: string) => ({
      id,
      kind: "button" as const,
      text: `Open ${popup_id}`,
      link: "",
      style: "primary" as const,
      action: "popup" as const,
      popup_id,
    });
    const out = html(
      <PageRenderer
        page={page([
          section({
            id: "a",
            section_type: "columns",
            content: {
              columns: [
                {
                  id: "c1",
                  items: [button("i1", "live"), button("i2", "disabled")],
                },
              ],
            },
          }),
        ])}
        registry={registry}
        now={NOW}
        openablePopups={new Set(["live"])}
      />,
    );
    expect(out).toContain('data-cds-popup-open="live"');
    expect(out).not.toContain('data-cds-popup-open="disabled"');
    expect(out).not.toContain("Open disabled");
  });

  it("never gives the eager image to a block that renders nothing; one h1 (WR-C08, CONT-35)", () => {
    const withAddon = composeSectionRegistry(CORE_SECTIONS, [
      { ...CORE_SECTIONS[3]!, type: "fixture-addon", label: "Fixture" },
    ]);
    const out = html(
      <PageRenderer
        page={page([
          section({
            id: "addon",
            section_type: "fixture-addon",
            content: {
              heading: "Silent",
              image_url: "https://img.example/a.jpg",
            },
          }),
          section({
            id: "b",
            section_type: "text-image",
            content: {
              heading: "Visible",
              image_url: "https://img.example/b.jpg",
              image_alt: "b",
            },
          }),
        ])}
        registry={withAddon}
        now={NOW}
      />,
    );
    expect(out).toMatch(/<h2[^>]*>Visible<\/h2>/);
    expect(out.match(/<h1/g)?.length).toBe(1);
    expect(out).toMatch(/<img[^>]*loading="eager"/);
  });

  it("renderableSections draws only registered core types", () => {
    // Three-way key parity lives in page-title.test.tsx (07-05).
    const withAddon = composeSectionRegistry(CORE_SECTIONS, [
      { ...CORE_SECTIONS[3]!, type: "fixture-addon", label: "Fixture" },
    ]);
    const rows = [
      { section_type: "fixture-addon" },
      { section_type: "hero" },
      { section_type: "unknown" },
    ];
    expect(renderableSections(rows, withAddon)).toEqual([
      { section_type: "hero" },
    ]);
  });

  it("renders a visible PageTitleHeader h1 when there is no Hero (D280)", () => {
    const out = html(
      <PageRenderer page={page([])} registry={registry} now={NOW} />,
    );
    expect(out.match(/<h1/g)?.length).toBe(1);
    expect(out).toMatch(/<h1 data-page-title=""[^>]*>Home<\/h1>/);
    expect(out).not.toContain("sr-only");
  });
});

// The hero-only H1 rule (07-04, CONT-35). The probe is always true once 07-04 is merged;
// 07-33's exit test asserts it unconditionally.
const HERO_ONLY =
  headingOwnerId(
    [
      section({
        id: "probe",
        section_type: "text-only",
        content: { heading: "Probe", text: "" },
      }),
    ],
    registry,
  ) === null;

describe.runIf(HERO_ONLY)("PageRenderer (hero-only H1)", () => {
  it("gives the h1 to the page title, not a heading-bearing text or columns block", () => {
    const out = html(
      <PageRenderer
        page={page([
          section({
            id: "a",
            section_type: "text-only",
            content: { heading: "About", text: "" },
          }),
          section({
            id: "b",
            section_type: "columns",
            content: {
              columns: [
                {
                  id: "c1",
                  items: [
                    { id: "i1", kind: "heading", text: "Welcome", level: 2 },
                  ],
                },
              ],
            },
          }),
        ])}
        registry={registry}
        now={NOW}
      />,
    );
    expect(out.match(/<h1/g)?.length).toBe(1);
    expect(out).toMatch(/<h1 data-page-title=""[^>]*>Home<\/h1>/);
    expect(out).toMatch(/<h2[^>]*>About<\/h2>/);
    expect(out).toMatch(/<h2[^>]*>Welcome<\/h2>/);
  });
});
