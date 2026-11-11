// ADDON-12/13 property: export then re-import of the same records plans every row unchanged,
// in both modes, including cells that start with formula triggers. Seeded mulberry32.
import { describe, expect, it } from "vitest";
import { quoteSpec as spec } from "./__fixtures__/spec";
import { validateRows } from "./columns";
import { parseCsv } from "./parse";
import { planImport } from "./plan";
import type { ExistingRecord } from "./plan";
import { exportCsv } from "./serialize";

const RUNS = 200;

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

const ALPHABET = [
  "a",
  "Q",
  "7",
  " ",
  ",",
  '"',
  "\r",
  "\n",
  "=",
  "+",
  "-",
  "@",
  "\t",
  "'",
  "é",
  "漢",
];

function text(rand: () => number): string {
  let s = "";
  const len = int(rand, 10);
  for (let i = 0; i < len; i++) s += ALPHABET[int(rand, ALPHABET.length)];
  // Required: at least one non-space character.
  return s.trim() === "" ? `${s}x` : s;
}

describe("export/import round trip", () => {
  it("plans every exported row as unchanged (200 seeded runs)", () => {
    for (let run = 0; run < RUNS; run++) {
      const rand = mulberry32(run + 101);
      const n = 1 + int(rand, 8);
      const existing: ExistingRecord[] = Array.from({ length: n }, (_, i) => ({
        id: `r${run}_${i}`,
        values: {
          quote: text(rand),
          name: text(rand),
          rating: rand() < 0.3 ? null : 1 + int(rand, 5),
        },
      }));
      const csv = exportCsv(
        spec,
        existing.map((r) => ({ id: r.id, ...r.values })),
      );
      const parsed = parseCsv(csv);
      if (!parsed.ok)
        throw new Error(`seed ${run + 101}: ${parsed.error.code}`);
      const v = validateRows(parsed, spec);
      if (!v.ok) throw new Error(`seed ${run + 101}: ${v.error.code}`);
      for (const mode of ["update", "replace"] as const) {
        const p = planImport({ rows: v.rows, existing, spec, mode });
        expect(
          p.rows.map((r) => r.status),
          `seed ${run + 101} ${mode}`,
        ).toEqual(existing.map(() => "unchanged"));
        expect(p.removals).toEqual([]);
        expect(p.creates).toEqual([]);
        expect(p.updates).toEqual([]);
      }
    }
  });

  it("an empty list exports a header-only file that the parser refuses cleanly", () => {
    const parsed = parseCsv(exportCsv(spec, []));
    expect(parsed.ok).toBe(false);
  });
});
