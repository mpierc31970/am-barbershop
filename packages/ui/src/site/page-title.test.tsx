// P7 render contract (07-05; CONT-13, CONT-35, D280, D-UI-P7-13; PATTERNS Finding 4, G6).
// Dispatch parity across CORE_SECTIONS / CORE_SECTION_TYPES / CORE_SECTION_COMPONENTS and
// the group A/B maps; coreData reaches core blocks only; own-property dispatch.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CORE_SECTIONS,
  FULL_WIDTH_ONLY,
  composeSectionRegistry,
  type PublishedPage,
  type PublishedSection,
  type SectionRegistry,
  type SectionTypeDefinition,
} from "@cds/core/content";
import { PageRenderer } from "./PageRenderer";
import { PageTitleHeader } from "./PageTitleHeader";
import { CORE_SECTION_COMPONENTS, SectionRenderer } from "./SectionRenderer";
import { SITE_BLOCKS_A } from "./blocks/group-a";
import { SITE_BLOCKS_B } from "./blocks/group-b";
import { CORE_SECTION_TYPES } from "./renderable";
import type { AddonSectionProps, CoreBoundData } from "./types";

const html = (node: ReactElement) => renderToStaticMarkup(node);
const NOW = new Date("2026-10-01T12:00:00.000Z");
const BASE = ["columns", "hero", "text-image", "text-only", "cta-banner"];

const stubDef = (type: string): SectionTypeDefinition => ({
  type,
  label: "Stub",
  description: "Stub add-on block",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => ({ heading: "" }),
  validate: (raw) => raw as Record<string, unknown>,
  mapRichText: (c) => c,
  textsOf: () => [],
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => ({ popups: [], forms: [], media: [] }),
});

const registry = composeSectionRegistry(CORE_SECTIONS, [stubDef("echo")]);

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

function Echo(props: AddonSectionProps) {
  return <pre>{JSON.stringify(Object.keys(props).sort())}</pre>;
}

const coreData: CoreBoundData = {
  media: {
    m1: {
      id: "m1",
      kind: "image",
      src: "https://media.example/m1-960.jpg",
      alt: "Studio",
    },
  },
};

describe("dispatch parity (WR-C08, G6)", () => {
  it("CORE_SECTION_TYPES, CORE_SECTION_COMPONENTS and CORE_SECTIONS hold the same types", () => {
    const types = [...CORE_SECTION_TYPES].sort();
    expect(types).toEqual(Object.keys(CORE_SECTION_COMPONENTS).sort());
    expect(types).toEqual(CORE_SECTIONS.map((d) => d.type).sort());
  });

  it("group keys are CORE_SECTIONS types, disjoint from each other and the base five", () => {
    const core = new Set(CORE_SECTIONS.map((d) => d.type));
    const a = Object.keys(SITE_BLOCKS_A);
    const b = Object.keys(SITE_BLOCKS_B);
    for (const k of [...a, ...b]) {
      expect(core.has(k)).toBe(true);
      expect(BASE).not.toContain(k);
    }
    expect(a.filter((k) => b.includes(k))).toEqual([]);
  });

  it("keeps the five base components ahead of any group entry", () => {
    for (const t of BASE) {
      expect(
        Object.prototype.hasOwnProperty.call(CORE_SECTION_COMPONENTS, t),
      ).toBe(true);
    }
    expect(Object.isFrozen(CORE_SECTION_COMPONENTS)).toBe(true);
  });
});

describe("SectionRenderer coreData (Finding 4, T-07-05-03)", () => {
  it("never passes coreData to an add-on renderer; data still arrives", () => {
    const out = html(
      <SectionRenderer
        section={section({ section_type: "echo", content: { heading: "" } })}
        registry={registry}
        isH1Owner={false}
        isFirst={false}
        now={NOW}
        renderers={{ echo: Echo }}
        data={{ live: true }}
        coreData={coreData}
      />,
    );
    expect(out).toContain("data");
    expect(out).not.toContain("coreData");
    expect(out).not.toContain("sectionId");
  });

  it("a core columns block renders unchanged when coreData is given", () => {
    const s = section({
      section_type: "columns",
      content: {
        columns: [
          {
            id: "c1",
            items: [
              {
                id: "i1",
                kind: "image",
                url: "https://img.example/a.jpg",
                alt: "A",
              },
            ],
          },
        ],
      },
    });
    const props = {
      section: s,
      registry,
      isH1Owner: false,
      isFirst: false,
      now: NOW,
    };
    expect(html(<SectionRenderer {...props} coreData={coreData} />)).toBe(
      html(<SectionRenderer {...props} />),
    );
    expect(html(<SectionRenderer {...props} coreData={coreData} />)).toContain(
      "https://img.example/a.jpg",
    );
  });

  it("ColumnsSection hands the media map to every item", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("./ColumnsSection.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toContain("media={coreData?.media}");
  });
});

describe("own-property dispatch (T-07-05-02)", () => {
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "a stored type %s never resolves a component",
    (type) => {
      // A registry that claims to know every type, so only the component maps decide.
      const permissive = {
        ...registry,
        get: () => stubDef("echo"),
      } as unknown as SectionRegistry;
      const out = html(
        <SectionRenderer
          section={section({ section_type: type, content: { heading: "x" } })}
          registry={permissive}
          isH1Owner={false}
          isFirst={false}
          now={NOW}
          renderers={{}}
        />,
      );
      expect(out).toBe("");
    },
  );
});

function page(sections: PublishedSection[], title = "Home"): PublishedPage {
  return {
    version: 1,
    page: {
      id: "p1",
      slug: "home",
      title,
      seo: {},
      password_protected: false,
    },
    sections,
    published_at: NOW.toISOString(),
  };
}

const h1s = (out: string) => out.match(/<h1/g)?.length ?? 0;

describe("page H1 rule (CONT-13, CONT-35, D280, D-UI-P7-13)", () => {
  it("a page with no blocks renders one visible PageTitleHeader h1 before any section", () => {
    const out = html(
      <PageRenderer page={page([])} registry={registry} now={NOW} />,
    );
    expect(h1s(out)).toBe(1);
    expect(out).toMatch(/<h1 data-page-title=""[^>]*>Home<\/h1>/);
    expect(out).not.toContain("sr-only");
    expect(out).toMatch(/^<main[^>]*><section/);
  });

  it("the title band comes first even when blocks follow", () => {
    const out = html(
      <PageRenderer
        page={page([
          section({
            id: "t",
            section_type: "text-only",
            content: { heading: "About", text: "" },
          }),
        ])}
        registry={registry}
        now={NOW}
      />,
    );
    expect(out.indexOf("data-page-title")).toBeLessThan(out.indexOf("About"));
    expect(h1s(out)).toBe(1);
    expect(out).toMatch(/<h2[^>]*>About<\/h2>/);
  });

  it("a page with a Hero renders the Hero heading as its only h1 and no title band", () => {
    const out = html(
      <PageRenderer
        page={page([
          section({
            id: "h",
            section_type: "hero",
            content: { heading: "Calm hands", subtitle: "" },
          }),
          section({
            id: "t",
            section_type: "text-only",
            content: { heading: "About", text: "" },
          }),
        ])}
        registry={registry}
        now={NOW}
      />,
    );
    expect(h1s(out)).toBe(1);
    expect(out).toMatch(/<h1[^>]*>Calm hands<\/h1>/);
    expect(out).not.toContain("data-page-title");
  });

  it("escapes the page title (T-07-05-01)", () => {
    const out = html(<PageTitleHeader title="<script>alert(1)</script>" />);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("renders on the theme surface band at the display size, balanced", () => {
    const out = html(<PageTitleHeader title="  Our services  " />);
    expect(out).toContain("bg-site-surface");
    expect(out).toContain("--site-text-display");
    expect(out).toContain("text-balance");
    expect(out).toMatch(/>Our services<\/h1>/);
  });

  it("passes coreData through: add-on blocks still never see it", () => {
    const out = html(
      <PageRenderer
        page={page([
          section({ id: "e", section_type: "echo", content: { heading: "" } }),
        ])}
        registry={registry}
        now={NOW}
        renderers={{ echo: Echo }}
        boundData={{ e: { live: true } }}
        coreData={coreData}
      />,
    );
    expect(out).toContain("data");
    expect(out).not.toContain("coreData");
    expect(out).not.toContain("sectionId");
  });

  it("a core columns block renders the same with coreData.media given", () => {
    const cols = page([
      section({
        id: "c",
        section_type: "columns",
        content: {
          columns: [
            {
              id: "c1",
              items: [
                {
                  id: "i1",
                  kind: "image",
                  url: "https://img.example/a.jpg",
                  alt: "A",
                },
              ],
            },
          ],
        },
      }),
    ]);
    expect(
      html(
        <PageRenderer
          page={cols}
          registry={registry}
          now={NOW}
          coreData={coreData}
        />,
      ),
    ).toBe(html(<PageRenderer page={cols} registry={registry} now={NOW} />));
  });
});
