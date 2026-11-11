// ColumnsSection + SectionRenderer source contract (CONT-03, CONT-07, invariant 6).
// Ported from donor columns-section.test.ts, predefined-block-grids.test.ts and
// seo-headings-alt.test.ts: the source-level checks stay (grid owned by RowRenderer,
// resolveColumns on read, clamp on read) and gain render checks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ColumnsContent } from "@cds/core/content";
import { ColumnsSection } from "./ColumnsSection";

const read = (f: string) => readFileSync(join(import.meta.dirname, f), "utf8");
const SECTION = read("ColumnsSection.tsx");
const DISPATCH = read("SectionRenderer.tsx");
const HERO = read("HeroSection.tsx");
const TEXT_IMAGE = read("TextImageSection.tsx");
const NOW = new Date("2026-10-01T12:00:00.000Z");

const render = (
  content: ColumnsContent,
  layout: Parameters<typeof ColumnsSection>[0]["layout"] = "50-50",
  isH1Owner = false,
  isFirst = false,
) =>
  renderToStaticMarkup(
    <ColumnsSection
      content={content}
      layout={layout}
      background="main"
      isH1Owner={isH1Owner}
      isFirst={isFirst}
      now={NOW}
    />,
  );

describe("ColumnsSection source contract (donor port)", () => {
  it("delegates the grid to RowRenderer rather than building its own", () => {
    expect(SECTION).toContain("<RowRenderer");
    expect(SECTION).not.toMatch(/grid-cols-/);
  });

  it("derives its columns through resolveColumns, never from a stored count", () => {
    expect(SECTION).toContain("resolveColumns(");
    expect(SECTION).not.toMatch(/column_count|columnCount/);
  });

  it("renders no body copy itself: it delegates to ColumnItemRenderer", () => {
    expect(SECTION).not.toContain("dangerouslySetInnerHTML");
    expect(SECTION).toContain("<ColumnItemRenderer");
  });
});

describe("SectionRenderer source contract", () => {
  it("dispatches the columns type to ColumnsSection", () => {
    expect(DISPATCH).toContain("columns: ColumnsSection");
  });

  it("reads the stored row_layout exactly once, inside clampLayout", () => {
    const reads = DISPATCH.match(/section\.row_layout/g) ?? [];
    const clamped =
      DISPATCH.match(/clampLayout\([^)]*section\.row_layout\)/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(clamped).toHaveLength(1);
  });

  it("looks the type up in the registry before dispatching", () => {
    expect(DISPATCH).toContain("registry.get(");
  });
});

describe("predefined blocks own their inner split (donor predefined-block-grids)", () => {
  it.each([
    ["HeroSection", HERO],
    ["TextImageSection", TEXT_IMAGE],
  ])("%s hands layout only to RowRenderer", (_name, source) => {
    expect(source).toContain("<RowRenderer layout={layout}");
    expect(source).not.toMatch(/grid-cols-\$\{/);
    expect(source).not.toMatch(/layout\s*===/);
    expect(source).not.toMatch(/columnCountFor|COLUMN_COUNT|resolveColumns/);
  });

  it.each([
    ["HeroSection", HERO],
    ["TextImageSection", TEXT_IMAGE],
  ])(
    "%s ignores reverse_columns and carries no hard-coded name",
    (_n, source) => {
      expect(source).not.toContain("reverse_columns");
      expect(source).not.toContain("Deborah");
    },
  );
});

describe("ColumnsSection render", () => {
  it("pads to the layout's column count (resolveColumns on read)", () => {
    const out = render({ columns: [] }, "33-33-33");
    expect(out).toContain("md:grid-cols-3");
    expect(out.match(/data-column/g)?.length).toBe(3);
  });

  it("folds surplus stored columns into the last rendered column", () => {
    const out = render(
      {
        columns: [
          { id: "a", items: [{ id: "1", kind: "list", items: ["one"] }] },
          { id: "b", items: [{ id: "2", kind: "list", items: ["two"] }] },
          { id: "c", items: [{ id: "3", kind: "list", items: ["three"] }] },
        ],
      },
      "50-50",
    );
    expect(out.match(/data-column/g)?.length).toBe(2);
    expect(out).toContain("three");
  });

  it("uses the column's first heading as the image alt fallback", () => {
    const out = render({
      columns: [
        {
          id: "a",
          items: [
            { id: "1", kind: "heading", text: "  Our garden ", level: 2 },
            {
              id: "2",
              kind: "image",
              url: "https://img.example/g.jpg",
              alt: "",
            },
          ],
        },
      ],
    });
    expect(out).toContain('alt="Our garden"');
  });

  it("renders an empty alt (decorative) rather than a made-up name when nothing fits", () => {
    const out = render({
      columns: [
        {
          id: "a",
          items: [
            {
              id: "2",
              kind: "image",
              url: "https://img.example/g.jpg",
              alt: "",
            },
          ],
        },
      ],
    });
    expect(out).toContain('alt=""');
  });

  it("promotes only the first heading item to h1 when the block owns the page h1", () => {
    const out = render(
      {
        columns: [
          {
            id: "a",
            items: [{ id: "1", kind: "heading", text: "Left", level: 3 }],
          },
          {
            id: "b",
            items: [{ id: "2", kind: "heading", text: "Right", level: 2 }],
          },
        ],
      },
      "50-50",
      true,
    );
    expect(out).toMatch(/<h1[^>]*>Left<\/h1>/);
    expect(out).toMatch(/<h2[^>]*>Right<\/h2>/);
  });

  it("eager-loads only the first image of the first block", () => {
    const content: ColumnsContent = {
      columns: [
        {
          id: "a",
          items: [
            {
              id: "1",
              kind: "image",
              url: "https://img.example/1.jpg",
              alt: "1",
            },
            {
              id: "2",
              kind: "image",
              url: "https://img.example/2.jpg",
              alt: "2",
            },
          ],
        },
      ],
    };
    const first = render(content, "full", false, true).match(/<img[^>]*>/g)!;
    expect(first[0]).toContain('loading="eager"');
    expect(first[1]).toContain('loading="lazy"');
    const later = render(content, "full", false, false).match(/<img[^>]*>/g)!;
    expect(later.every((i) => i.includes('loading="lazy"'))).toBe(true);
  });

  it("eager-loads a first library image (asset, no url) (WR-D05)", () => {
    const content: ColumnsContent = {
      columns: [
        {
          id: "a",
          items: [
            { id: "1", kind: "image", url: "", asset: "m1", alt: "Lib" },
            {
              id: "2",
              kind: "image",
              url: "https://img.example/2.jpg",
              alt: "2",
            },
          ],
        },
      ],
    };
    const out = renderToStaticMarkup(
      <ColumnsSection
        content={content}
        layout="full"
        background="main"
        isH1Owner={false}
        isFirst
        now={NOW}
        coreData={{
          media: {
            m1: {
              id: "m1",
              kind: "image",
              src: "/_media/org1/image/m1/w960.webp",
              alt: "Lib",
            },
          },
        }}
      />,
    );
    const imgs = out.match(/<img[^>]*>/g)!;
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toContain("m1");
    expect(imgs[0]).toContain('loading="eager"');
    expect(imgs[1]).toContain('loading="lazy"');
  });
});
