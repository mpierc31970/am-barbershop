// CONT-07 property test (RESEARCH Pitfall 3). Random sequences of layout changes, column
// moves and item moves, each followed by normalizeColumns, must always draw exactly
// COLUMN_COUNT[layout] columns, never lose or duplicate an item, and never duplicate a
// column id. Seeded PRNG (mulberry32), no new dependency, so failures reproduce.
import { describe, expect, it } from "vitest";
import { moveColumn, moveItem, normalizeColumns } from "./columns";
import { ALL_LAYOUTS, COLUMN_COUNT } from "./layouts";
import type { ColumnsContent, RowLayout } from "./types";

const ITERATIONS = 500;
const STEPS = 12;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function int(rand: () => number, n: number): number {
  return Math.floor(rand() * n);
}

function randomContent(rand: () => number, iter: number): ColumnsContent {
  const colCount = int(rand, 7); // 0..6 stored columns, often wrong for the layout
  let next = 0;
  return {
    columns: Array.from({ length: colCount }, (_, c) => ({
      id: `it${iter}-c${c}`,
      items: Array.from({ length: int(rand, 4) }, () => ({
        id: `it${iter}-i${next++}`,
        kind: "divider" as const,
      })),
    })),
  };
}

function itemIds(content: ColumnsContent): string[] {
  return content.columns.flatMap((c) => c.items.map((i) => i.id)).sort();
}

function assertInvariants(
  content: ColumnsContent,
  layout: RowLayout,
  expectedItems: string[],
  label: string,
): void {
  expect(content.columns.length, label).toBe(COLUMN_COUNT[layout]);
  expect(itemIds(content), label).toEqual(expectedItems);
  const colIds = content.columns.map((c) => c.id);
  expect(new Set(colIds).size, label).toBe(colIds.length);
}

describe("columns property (CONT-07)", () => {
  it(`keeps every invariant across ${ITERATIONS} random edit sequences`, () => {
    const rand = mulberry32(0xc0de5);
    for (let iter = 0; iter < ITERATIONS; iter += 1) {
      let layout = ALL_LAYOUTS[int(rand, ALL_LAYOUTS.length)]!;
      const initial = randomContent(rand, iter);
      const expected = itemIds(initial);
      let content = normalizeColumns(initial, layout);
      assertInvariants(content, layout, expected, `iter ${iter} start`);

      for (let step = 0; step < STEPS; step += 1) {
        const op = int(rand, 3);
        const n = content.columns.length;
        if (op === 0) {
          layout = ALL_LAYOUTS[int(rand, ALL_LAYOUTS.length)]!;
        } else if (op === 1) {
          content = moveColumn(content, int(rand, n), int(rand, n));
        } else {
          const from = content.columns[int(rand, n)]!;
          if (from.items.length > 0) {
            const to = content.columns[int(rand, n)]!;
            content = moveItem(content, {
              fromColumnId: from.id,
              fromIndex: int(rand, from.items.length),
              toColumnId: to.id,
              toIndex: int(rand, to.items.length + 1),
            });
          }
        }
        content = normalizeColumns(content, layout);
        assertInvariants(
          content,
          layout,
          expected,
          `iter ${iter} step ${step}`,
        );
      }
    }
  });
});
