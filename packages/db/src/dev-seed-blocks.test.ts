// 07-33 choice 4: the every-block fixture covers every core section type and every column
// item kind, and every section passes its registry validator. A new block fails here until
// it is added to BLOCKS_FIXTURE (so the exit test and Lighthouse cover it).
import {
  COLUMN_ITEM_KINDS,
  composeSectionRegistry,
  CORE_SECTIONS,
} from "@cds/core/content";
import { describe, expect, it } from "vitest";
import {
  BLOCKS_FIXTURE,
  resolveBlocksTokens,
  type BlocksPageKey,
} from "./dev-seed-blocks";
import * as root from "./index";

const registry = composeSectionRegistry(CORE_SECTIONS, []);
const pages = Object.entries(BLOCKS_FIXTURE.pages) as [
  BlocksPageKey,
  (typeof BLOCKS_FIXTURE.pages)[BlocksPageKey],
][];

/** A 15-char lowercase record id per token. */
function fakeId(token: string): string {
  return token
    .replace(/[^a-z0-9]/g, "")
    .padEnd(15, "0")
    .slice(0, 15);
}

function kindsIn(value: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => kindsIn(v, out));
  else if (value && typeof value === "object") {
    const r = value as Record<string, unknown>;
    if (typeof r.kind === "string") out.add(r.kind);
    Object.values(r).forEach((v) => kindsIn(v, out));
  }
  return out;
}

function textOf(page: (typeof pages)[number][1]): string {
  return JSON.stringify(page);
}

describe("BLOCKS_FIXTURE coverage (07-33 choice 4)", () => {
  it("uses every core section type", () => {
    const used = new Set(
      pages.flatMap(([, p]) => p.sections.map((s) => s.type)),
    );
    expect([...used].sort()).toEqual(CORE_SECTIONS.map((s) => s.type).sort());
  });

  it("uses every column item kind (columns, slides, tabs or the pop-up)", () => {
    const kinds = kindsIn(BLOCKS_FIXTURE, new Set());
    for (const k of COLUMN_ITEM_KINDS) expect(kinds, k).toContain(k);
  });

  it("has at most one hero per page", () => {
    for (const [, p] of pages) {
      expect(
        p.sections.filter((s) => s.type === "hero").length,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("every section passes its registry validator with placeholder ids", () => {
    for (const [key, p] of pages) {
      for (const s of p.sections) {
        const def = registry.get(s.type);
        expect(def, `${key}/${s.type}`).toBeDefined();
        const content = resolveBlocksTokens(s.content, fakeId);
        expect(
          () => def!.validate(content, s.layout as never),
          `${key}/${s.type}`,
        ).not.toThrow();
      }
    }
  });

  it("titles and descriptions fit the SEO limits", () => {
    for (const [, p] of pages) {
      expect(p.title.length).toBeLessThanOrEqual(60);
      expect(p.description.length).toBeLessThanOrEqual(160);
    }
  });

  const section = (page: BlocksPageKey, type: string) =>
    BLOCKS_FIXTURE.pages[page].sections.find((s) => s.type === type)!
      .content as unknown as never;

  it("gallery: 14 images, 12 per page, lightbox on", () => {
    const g = section("gallery", "gallery") as {
      images: unknown[];
      per_page: number;
      lightbox: boolean;
    };
    expect(g.images).toHaveLength(14);
    expect(g.per_page).toBe(12);
    expect(g.lightbox).toBe(true);
  });

  it("logo strip: 4 logos, exactly one link", () => {
    const l = section("gallery", "logo-strip") as { logos: { link: string }[] };
    expect(l.logos).toHaveLength(4);
    expect(l.logos.filter((x) => x.link !== "")).toHaveLength(1);
  });

  it("faq: 3 answered entries; stats count up; table has a header row and a link", () => {
    const f = section("home", "faq") as { items: { answer: string }[] };
    expect(f.items).toHaveLength(3);
    expect(f.items.every((i) => i.answer.length > 0)).toBe(true);
    expect((section("home", "stats") as { count_up: boolean }).count_up).toBe(
      true,
    );
    const tb = section("home", "table") as {
      header_row: boolean;
      rows: { link: string }[][];
    };
    expect(tb.header_row).toBe(true);
    expect(tb.rows.flat().some((c) => c.link !== "")).toBe(true);
  });

  it("marker words: the protected word is only on members, the FAQ word only in the FAQ", () => {
    const { faq, protectedOnly } = BLOCKS_FIXTURE.words;
    for (const [key, p] of pages) {
      expect(textOf(p).includes(protectedOnly), key).toBe(key === "members");
    }
    for (const [key, p] of pages) {
      for (const s of p.sections) {
        const has = JSON.stringify(s.content).toLowerCase().includes(faq);
        if (has) expect(`${key}/${s.type}`).toBe("home/faq");
      }
    }
    expect(JSON.stringify(BLOCKS_FIXTURE.popup).includes(protectedOnly)).toBe(
      false,
    );
  });

  it("is not exported from the @cds/db root", () => {
    expect(Object.keys(root)).not.toContain("seedBlocksTenant");
  });
});
