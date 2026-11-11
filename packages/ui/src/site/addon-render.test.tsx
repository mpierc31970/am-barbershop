// Add-on block injection into the site renderers (ADDON-05, ADDON-08; D253; RESEARCH
// Patterns 6 and 9, Pitfall 9; WR-C08). @cds/ui never imports an add-on: renderers, live
// data and the isDrawn gate are passed in by the app.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CORE_SECTIONS,
  FULL_WIDTH_ONLY,
  composeSectionRegistry,
  type PublishedPage,
  type PublishedSection,
} from "@cds/core/content";
import { PageRenderer } from "./PageRenderer";
import { renderableSections } from "./renderable";
import { HEADING_CLASSES, type AddonSectionProps } from "./types";

const html = (node: ReactElement) => renderToStaticMarkup(node);
const NOW = new Date("2026-10-01T12:00:00.000Z");

const registry = composeSectionRegistry(CORE_SECTIONS, [
  {
    type: "quotes",
    label: "Quotes",
    description: "Stub add-on block",
    layouts: FULL_WIDTH_ONLY,
    defaultContent: () => ({ heading: "" }),
    validate: (raw) => raw as Record<string, unknown>,
    mapRichText: (c) => c,
    textsOf: () => [],
    urlsOf: () => [],
    headings: { ownsH1: false, blockHeading: "h2" },
    refsOf: () => ({ popups: [], forms: [], media: [] }),
  },
]);

function Quotes({
  content,
  data,
  isH1Owner,
}: AddonSectionProps<{ heading?: string }, string[]>) {
  const list = Array.isArray(data) ? data : [];
  if (list.length === 0) return null;
  const H = isH1Owner ? "h1" : "h2";
  return (
    <section data-block="quotes">
      {content.heading ? (
        <H className={HEADING_CLASSES[isH1Owner ? 1 : 2]}>{content.heading}</H>
      ) : null}
      {list.map((q) => (
        <blockquote key={q}>{q}</blockquote>
      ))}
    </section>
  );
}

const RENDERERS = { quotes: Quotes };

function section(
  id: string,
  section_type: string,
  content: unknown,
): PublishedSection {
  return {
    id,
    section_type,
    content,
    row_layout: "full",
    settings: { background_variant: "main" },
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
  } as PublishedPage;
}

const quotesBlock = section("s1", "quotes", { heading: "Kind words" });
const textBlock = section("s2", "text-only", {
  heading: "About us",
  text: "<p>Hello</p>",
});

const nonEmpty =
  (data: Readonly<Record<string, unknown>>) =>
  (s: { id: string; section_type: string }) =>
    s.section_type !== "quotes" ||
    (Array.isArray(data[s.id]) && (data[s.id] as unknown[]).length > 0);

describe("add-on renderer injection", () => {
  it("renders an injected renderer with its bound data", () => {
    const boundData = { s1: ["Wonderful care"] };
    const out = html(
      <PageRenderer
        page={page([quotesBlock])}
        registry={registry}
        now={NOW}
        renderers={RENDERERS}
        boundData={boundData}
      />,
    );
    expect(out).toContain('data-block="quotes"');
    expect(out).toContain("Wonderful care");
    expect(out).toMatch(/<h2[^>]*>Kind words<\/h2>/);
    expect(out.match(/<h1/g)?.length).toBe(1);
  });

  it("skips an add-on section when no renderer is injected", () => {
    const out = html(
      <PageRenderer
        page={page([quotesBlock, textBlock])}
        registry={registry}
        now={NOW}
        boundData={{ s1: ["Wonderful care"] }}
      />,
    );
    expect(out).not.toContain("Wonderful care");
    expect(out).toMatch(/<h2[^>]*>About us<\/h2>/);
    expect(out.match(/<h1/g)?.length).toBe(1);
  });

  it("an undrawn empty add-on block is absent and the page keeps exactly one h1", () => {
    const boundData = { s1: [] };
    const out = html(
      <PageRenderer
        page={page([quotesBlock, textBlock])}
        registry={registry}
        now={NOW}
        renderers={RENDERERS}
        boundData={boundData}
        isDrawn={nonEmpty(boundData)}
      />,
    );
    expect(out).not.toContain('data-block="quotes"');
    expect(out).toMatch(/<h2[^>]*>About us<\/h2>/);
    expect(out.match(/<h1/g)?.length).toBe(1);
  });

  it("isDrawn false hides the block even when data is present", () => {
    const out = html(
      <PageRenderer
        page={page([quotesBlock, textBlock])}
        registry={registry}
        now={NOW}
        renderers={RENDERERS}
        boundData={{ s1: ["Wonderful care"] }}
        isDrawn={(s) => s.section_type !== "quotes"}
      />,
    );
    expect(out).not.toContain("Wonderful care");
    expect(out).toMatch(/<h2[^>]*>About us<\/h2>/);
    expect(out.match(/<h1/g)?.length).toBe(1);
  });

  it("core sections are unaffected without injection props", () => {
    const out = html(
      <PageRenderer page={page([textBlock])} registry={registry} now={NOW} />,
    );
    expect(out).toMatch(/<h2[^>]*>About us<\/h2>/);
    expect(out.match(/<h1/g)?.length).toBe(1);
  });

  it("renderer lookups are own-property only", () => {
    const proto = section("s3", "constructor", {});
    const out = html(
      <PageRenderer
        page={page([proto, textBlock])}
        registry={registry}
        now={NOW}
        renderers={RENDERERS}
      />,
    );
    expect(out).toMatch(/<h2[^>]*>About us<\/h2>/);
    expect(out.match(/<h1/g)?.length).toBe(1);
  });

  it("renderableSections honours extraTypes and isDrawn", () => {
    const rows = [
      { id: "a", section_type: "quotes" },
      { id: "b", section_type: "hero" },
      { id: "c", section_type: "unknown" },
    ];
    expect(renderableSections(rows, registry).map((r) => r.id)).toEqual(["b"]);
    const extra = new Set(["quotes", "unknown"]);
    expect(
      renderableSections(rows, registry, { extraTypes: extra }).map(
        (r) => r.id,
      ),
    ).toEqual(["a", "b"]);
    expect(
      renderableSections(rows, registry, {
        extraTypes: extra,
        isDrawn: (r) => r.id !== "a",
      }).map((r) => r.id),
    ).toEqual(["b"]);
  });
});
