// Slider and tabs server renderers (07-20 Task 2; CONT-23, CONT-27, CONT-35, D229).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CORE_SECTIONS,
  composeSectionRegistry,
  defaultSliderContent,
  defaultTabsContent,
  type ColumnItem,
  type PublishedPage,
  type PublishedSection,
  type SliderContent,
  type TabsContent,
} from "@cds/core/content";
import { PageRenderer } from "../PageRenderer";
import type { CoreBoundData } from "../types";
import { SLIDER_NOSCRIPT_CSS, SliderSection } from "./SliderSection";
import { TABS_NOSCRIPT_CSS, TabsSection } from "./TabsSection";

const html = (node: ReactElement) => renderToStaticMarkup(node);
const NOW = new Date("2026-10-01T12:00:00.000Z");
const registry = composeSectionRegistry(CORE_SECTIONS, []);

const text = (id: string, body: string): ColumnItem => ({
  id,
  kind: "text",
  html: `<p>${body}</p>`,
});
const heading = (id: string, t: string, level: 2 | 3 = 2): ColumnItem => ({
  id,
  kind: "heading",
  text: t,
  level,
});

function slider(
  items: ColumnItem[][],
  over: Partial<SliderContent> = {},
): SliderContent {
  const c = defaultSliderContent();
  while (c.slides.length < items.length) {
    c.slides.push({ ...defaultSliderContent().slides[0] });
  }
  items.forEach((list, i) => {
    c.slides[i].columns[0].items = list;
  });
  return { ...c, ...over };
}

function tabs(items: ColumnItem[][], heading = ""): TabsContent {
  const c = defaultTabsContent();
  while (c.tabs.length < items.length) {
    c.tabs.push({
      ...defaultTabsContent().tabs[0],
      label: `Tab ${c.tabs.length + 1}`,
    });
  }
  items.forEach((list, i) => {
    c.tabs[i].columns[0].items = list;
  });
  return { ...c, heading };
}

function renderSlider(
  content: SliderContent,
  extra: { isFirst?: boolean; coreData?: CoreBoundData } = {},
) {
  return html(
    <SliderSection
      content={content}
      layout="full"
      background="main"
      isH1Owner={false}
      isFirst={extra.isFirst ?? false}
      now={NOW}
      coreData={extra.coreData}
    />,
  );
}

function renderTabs(content: TabsContent) {
  return html(
    <TabsSection
      content={content}
      layout="full"
      background="main"
      isH1Owner={false}
      isFirst={false}
      now={NOW}
    />,
  );
}

describe("SliderSection", () => {
  it("default content (2 empty slides) renders nothing", () => {
    expect(renderSlider(defaultSliderContent())).toBe("");
  });

  it("one non-empty slide renders its items and no controls bar", () => {
    const out = renderSlider(slider([[text("t1", "Only slide")], []]));
    expect(out).toContain("Only slide");
    expect(out).not.toContain("data-slider-controls");
    expect(out).not.toContain("<noscript>");
  });

  it("three slides: one region, three groups, labelled heading, noscript, no h1", () => {
    const c = slider(
      [[text("a", "One")], [text("b", "Two")], [text("c", "Three")]],
      { heading: "Our spring menu" },
    );
    const out = renderSlider(c);
    expect(out.match(/role="region"/g)).toHaveLength(1);
    expect(out.match(/role="group"/g)).toHaveLength(3);
    const id = `cds-slider-${c.slides[0].id}`;
    expect(out).toContain(`<h2 id="${id}"`);
    expect(out).toContain(`aria-labelledby="${id}"`);
    expect(out).toContain(
      `<noscript><style>${SLIDER_NOSCRIPT_CSS}</style></noscript>`,
    );
    expect(out).not.toContain("<h1");
    expect(out).toContain('aria-label="3 of 3"');
  });

  it("the noscript CSS is the fixed constant (no owner input)", () => {
    expect(SLIDER_NOSCRIPT_CSS).toBe(
      "[data-cds-slider] [data-slider-viewport]{display:flex;flex-direction:column;gap:2rem}" +
        "[data-cds-slider] [data-slide]{visibility:visible;transform:none;translate:none;opacity:1;grid-area:auto}" +
        "[data-cds-slider] [data-slider-controls]{display:none}",
    );
  });

  it("demotes slide headings to h3 under a block heading, keeps h2 without one", () => {
    const items = [[heading("h", "Slide title", 2)], [text("t", "x")]];
    const withHeading = renderSlider(slider(items, { heading: "Block" }));
    expect(withHeading).toMatch(/<h3[^>]*>Slide title<\/h3>/);
    const blank = renderSlider(slider(items));
    expect(blank).toMatch(/<h2[^>]*>Slide title<\/h2>/);
    expect(blank).toContain('aria-label="Slides"');
  });

  it("items get media from coreData; the first image is eager when first block", () => {
    const image: ColumnItem = {
      id: "img",
      kind: "image",
      url: "",
      alt: "Room",
      asset: "a1",
    };
    const coreData: CoreBoundData = {
      media: {
        a1: {
          id: "a1",
          kind: "image",
          src: "/_media/org/a1/w960.webp",
          alt: "",
        },
      },
    };
    const c = slider([[image], [text("t", "x")]]);
    const first = renderSlider(c, { isFirst: true, coreData });
    expect(first).toContain('src="/_media/org/a1/w960.webp"');
    expect(first).toContain('loading="eager"');
    const later = renderSlider(c, { isFirst: false, coreData });
    expect(later).toContain('loading="lazy"');
  });

  it("only the first slide's image is eager", () => {
    const img = (id: string): ColumnItem => ({
      id,
      kind: "image",
      url: `https://cdn.example.com/${id}.jpg`,
      alt: id,
    });
    const out = renderSlider(slider([[img("one")], [img("two")]]), {
      isFirst: true,
    });
    expect(out.match(/loading="eager"/g)).toHaveLength(1);
  });
});

describe("TabsSection", () => {
  it("empty panels are dropped; none left renders nothing", () => {
    expect(renderTabs(defaultTabsContent())).toBe("");
  });

  it("one tab left renders its panel without a tablist", () => {
    const out = renderTabs(tabs([[text("a", "Alone")], []]));
    expect(out).toContain("Alone");
    expect(out).not.toContain('role="tablist"');
    expect(out).not.toContain("<noscript>");
  });

  it("three tabs: tablist, three panels (first open), noscript, no h1", () => {
    const c = tabs(
      [[text("a", "A")], [text("b", "B")], [heading("h", "Inside", 2)]],
      "Our services",
    );
    const out = renderTabs(c);
    expect(out.match(/role="tablist"/g)).toHaveLength(1);
    expect(out.match(/role="tab"/g)).toHaveLength(3);
    expect(out.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(out).toContain(`aria-labelledby="cds-tabs-${c.tabs[0].id}"`);
    expect(out).toContain(
      `<noscript><style>${TABS_NOSCRIPT_CSS}</style></noscript>`,
    );
    expect(out).not.toContain("<h1");
    // label headings are h3 under a block heading; the panel heading demotes to h3
    expect(out).toMatch(/<h3 data-tab-label=""[^>]*>First tab<\/h3>/);
    expect(out).toMatch(/<h3[^>]*>Inside<\/h3>/);
    const panels = out.match(/<div role="tabpanel"[^>]*>/g) ?? [];
    expect(panels[0]).not.toMatch(/hidden/);
    expect(panels[1]).toMatch(/hidden/);
  });

  it("label headings are h2 without a block heading", () => {
    const out = renderTabs(tabs([[text("a", "A")], [text("b", "B")]]));
    expect(out).toMatch(/<h2 data-tab-label=""[^>]*>First tab<\/h2>/);
    expect(out).not.toContain('aria-labelledby="cds-tabs-');
  });

  it("the noscript CSS is the fixed constant", () => {
    expect(TABS_NOSCRIPT_CSS).toBe(
      "[data-cds-tabs] [role=tablist]{display:none}" +
        "[data-cds-tabs] [role=tabpanel]{display:block}" +
        "[data-cds-tabs] [data-tab-label]{display:block}",
    );
  });
});

describe("one H1 per page (CONT-35)", () => {
  it("a page with a filled slider and tabs and no Hero has exactly one h1", () => {
    const s = slider([[heading("h1x", "Slide head", 2)], [text("t", "x")]]);
    const t = tabs([[heading("h2x", "Tab head", 2)], [text("u", "y")]]);
    const page = {
      version: 1,
      page: {
        id: "p1",
        slug: "home",
        title: "Home",
        seo: {},
        password_protected: false,
      },
      sections: [
        {
          id: "s1",
          section_type: "slider",
          row_layout: "full",
          settings: { background_variant: "main" },
          content: s,
        },
        {
          id: "s2",
          section_type: "tabs",
          row_layout: "full",
          settings: { background_variant: "alternate" },
          content: t,
        },
      ] as PublishedSection[],
      published_at: NOW.toISOString(),
    } as PublishedPage;
    const out = html(
      <PageRenderer page={page} registry={registry} now={NOW} />,
    );
    expect(out.match(/<h1/g)?.length ?? 0).toBe(1);
    expect(out).toContain("data-cds-slider");
    expect(out).toContain("data-cds-tabs");
  });
});
