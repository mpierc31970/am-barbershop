// ADDON-12 row validation and ADDON-13 import planning (D125 modes, D126 dedupe).
import { describe, expect, it } from "vitest";
import { quoteSpec as spec } from "./__fixtures__/spec";
import { mapColumns, validateRows } from "./columns";
import { parseCsv } from "./parse";
import { normalizeKey, planImport, toImportPreview } from "./plan";
import type { ExistingRecord, ImportMode } from "./plan";

function validate(text: string) {
  const parsed = parseCsv(text);
  if (!parsed.ok) throw new Error(parsed.error.code);
  const v = validateRows(parsed, spec);
  if (!v.ok) throw new Error(v.error.code);
  return v;
}

function plan(
  text: string,
  existing: ExistingRecord[],
  mode: ImportMode = "update",
) {
  return planImport({ rows: validate(text).rows, existing, spec, mode });
}

const existing: ExistingRecord[] = [
  { id: "e1", values: { quote: "Great", name: "Ann", rating: 5 } },
  { id: "e2", values: { quote: "Lovely", name: "Bo", rating: null } },
];

describe("mapColumns", () => {
  it("matches labels case-insensitively after trim, finds id, reports unknown headers", () => {
    const m = mapColumns([" quote ", "NAME", "id", "Notes", ""], spec);
    if (!m.ok) throw new Error("expected ok");
    expect(m.index).toEqual({ quote: 0, name: 1 });
    expect(m.idIndex).toBe(2);
    expect(m.ignored).toEqual(["Notes"]);
  });

  it("refuses a missing required column with UI-SPEC copy", () => {
    const m = mapColumns(["Name", "Rating"], spec);
    if (m.ok) throw new Error("expected error");
    expect(m.error.code).toBe("missing_column");
    expect(m.error.message).toBe(
      "The file is missing the Quote column. Download the template to see the columns we need.",
    );
  });

  it("allows a missing optional column", () => {
    const m = mapColumns(["Quote", "Name"], spec);
    expect(m.ok).toBe(true);
  });
});

describe("validateRows", () => {
  it("numbers rows as spreadsheet rows and reports column messages", () => {
    const v = validate("Quote,Name,Rating\nA,Ann,5\nB,Bo,\nC,Cy,9\n");
    expect(v.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4]);
    expect(v.rows[0]!.values).toEqual({ quote: "A", name: "Ann", rating: 5 });
    expect(v.rows[1]!.values.rating).toBeNull();
    expect(v.rows[2]!.errors).toEqual([
      "Row 4: Rating must be a number from 1 to 5.",
    ]);
  });

  it("flags an empty required cell", () => {
    const v = validate("Quote,Name\n  ,Ann\n");
    expect(v.rows[0]!.errors).toEqual(["Row 2: Quote is empty."]);
  });

  it("unguards formula cells before parsing and reads the id", () => {
    const v = validate("id,Quote,Name\nabc,'=great,Ann\n");
    expect(v.rows[0]!.id).toBe("abc");
    expect(v.rows[0]!.values.quote).toBe("=great");
    expect(v.ignored).toEqual([]);
  });

  it("returns ignored headers", () => {
    expect(validate("Quote,Name,Notes\nA,B,c\n").ignored).toEqual(["Notes"]);
  });
});

describe("planImport", () => {
  it("classifies new, updated and unchanged by natural key", () => {
    const p = plan(
      "Quote,Name,Rating\nGreat,Ann,5\nLovely,Bo,4\nNew one,Cy,\n",
      existing,
    );
    expect(p.rows.map((r) => r.status)).toEqual([
      "unchanged",
      "updated",
      "new",
    ]);
    expect(p.rows[1]!.changed).toEqual(["rating"]);
    expect(p.counts).toEqual({
      new: 1,
      updated: 1,
      unchanged: 1,
      duplicates: 0,
      errors: 0,
    });
    expect(p.creates).toEqual([{ quote: "New one", name: "Cy", rating: null }]);
    expect(p.updates).toEqual([
      { id: "e2", values: { quote: "Lovely", name: "Bo", rating: 4 } },
    ]);
    expect(p.removals).toEqual([]);
  });

  it("matches by id first, even when the natural key changed", () => {
    const p = plan("id,Quote,Name,Rating\ne1,Edited quote,Ann,5\n", existing);
    expect(p.rows[0]!.status).toBe("updated");
    expect(p.rows[0]!.id).toBe("e1");
    expect(p.rows[0]!.changed).toEqual(["quote"]);
  });

  it("refuses an id that no longer exists", () => {
    const p = plan("id,Quote,Name\ngone,X,Y\n", existing);
    expect(p.rows[0]!.status).toBe("error");
    expect(p.rows[0]!.messages).toEqual([
      "Row 2: This id belongs to a testimonial that no longer exists. Clear the id to add it as new.",
    ]);
    expect(p.counts.errors).toBe(1);
  });

  it("counts and skips duplicates in the file (key and id)", () => {
    const p = plan(
      "id,Quote,Name\n,Fresh,Dee\n, fresh ,DEE\ne1,Great,Ann\ne1,Great,Ann\n",
      existing,
    );
    expect(p.rows.map((r) => r.status)).toEqual([
      "new",
      "duplicate",
      "unchanged",
      "duplicate",
    ]);
    expect(p.counts.duplicates).toBe(2);
    expect(p.creates).toHaveLength(1);
  });

  it("treats a key row matching an already-matched record as a duplicate", () => {
    const p = plan(
      "id,Quote,Name,Rating\ne1,Great,Ann,5\n,Great,Ann,5\n",
      existing,
    );
    expect(p.rows.map((r) => r.status)).toEqual(["unchanged", "duplicate"]);
  });

  it("keeps the full plan when rows have errors", () => {
    const p = plan("Quote,Name,Rating\nA,Ann,7\nB,Bo,\n", []);
    expect(p.counts.errors).toBe(1);
    expect(p.rows[0]!.messages).toEqual([
      "Row 2: Rating must be a number from 1 to 5.",
    ]);
    expect(p.rows[1]!.status).toBe("new");
  });

  it("replace mode lists exactly the unmatched records as removals", () => {
    const p = plan("Quote,Name,Rating\nGreat,Ann,5\n", existing, "replace");
    expect(p.removals.map((r) => r.id)).toEqual(["e2"]);
    const u = plan("Quote,Name,Rating\nGreat,Ann,5\n", existing, "update");
    expect(u.removals).toEqual([]);
  });
});

describe("normalizeKey", () => {
  it("NFC, trims, collapses whitespace, lowercases, joins with NUL", () => {
    expect(
      normalizeKey(
        { name: "  Ann   Lee ", quote: `Cafe${String.fromCharCode(0x301)}` },
        ["name", "quote"],
      ),
    ).toBe(`ann lee${String.fromCharCode(0)}caf${String.fromCharCode(0xe9)}`);
    expect(normalizeKey({ name: null }, ["name", "quote"])).toBe("\u0000");
  });
});

describe("toImportPreview", () => {
  it("formats cells, titles removals and counts changes", () => {
    const v = validate("Quote,Name,Rating,Notes\nGreat,Ann,4\nNew,Cy,\n");
    const p = planImport({ rows: v.rows, existing, spec, mode: "replace" });
    const preview = toImportPreview(
      p,
      spec,
      (vals) => String(vals.name),
      v.ignored,
    );
    expect(preview.columns).toEqual([
      { key: "quote", label: "Quote" },
      { key: "name", label: "Name" },
      { key: "rating", label: "Rating" },
    ]);
    expect(preview.rows[0]).toEqual({
      rowNumber: 2,
      status: "updated",
      cells: { quote: "Great", name: "Ann", rating: "4" },
      changed: ["rating"],
      messages: [],
    });
    expect(preview.removals).toEqual([{ id: "e2", title: "Bo" }]);
    expect(preview.changes).toBe(3);
    expect(preview.ignored).toEqual(["Notes"]);
    expect(preview.mode).toBe("replace");
    expect(JSON.parse(JSON.stringify(preview))).toEqual(preview);
  });

  it("update mode does not count removals", () => {
    const v = validate("Quote,Name\nNew,Cy\n");
    const p = planImport({ rows: v.rows, existing, spec, mode: "update" });
    expect(toImportPreview(p, spec, () => "", v.ignored).changes).toBe(1);
  });
});
