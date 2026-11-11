// Pure record-rule pass of the CSV import planner (B-WR-01, D120). DB behaviour is covered
// by test/addons-import.integration.test.ts on the real PocketBase binary.
import { InvalidInput } from "@cds/core";
import type { AddonRecordSpec } from "@cds/core/addons";
import { planImport, validateRows, type CsvSpec } from "@cds/core/csv";
import { describe, expect, it } from "vitest";
import { applyRecordRules } from "./import";

const text = (raw: string) => ({ ok: true as const, value: raw.trim() });
const CSV: CsvSpec = {
  collection: "things",
  columns: [
    {
      key: "name",
      label: "Name",
      required: true,
      example: "A",
      parse: text,
      format: String,
    },
    {
      key: "start",
      label: "Start",
      required: false,
      example: "1",
      parse: text,
      format: String,
    },
    {
      key: "end",
      label: "End",
      required: false,
      example: "2",
      parse: text,
      format: String,
    },
  ],
  naturalKey: ["name"],
  singular: "thing",
  plural: "things",
};

const seen: Record<string, unknown>[] = [];
const SPEC: AddonRecordSpec = {
  singular: "thing",
  plural: "things",
  validate(raw) {
    const v = raw as Record<string, unknown>;
    seen.push(v);
    if (v.start && v.end && String(v.end) < String(v.start)) {
      throw new InvalidInput("End is before Start.");
    }
    return v;
  },
  textsOf: () => [],
  urlsOf: () => [],
  title: (v) => String(v.name),
  publishedField: "is_published",
  orderField: "sort_order",
};

function plan(rows: string[][], records: Record<string, unknown>[] = []) {
  const v = validateRows({ header: ["Name", "Start", "End"], rows }, CSV);
  if (!v.ok) throw new Error("bad header");
  const existing = records.map((r) => ({ id: String(r.id), values: r }));
  return planImport({ rows: v.rows, existing, spec: CSV, mode: "update" });
}

describe("applyRecordRules (B-WR-01)", () => {
  it("turns a new row that fails a cross-field rule into an error row at preview time", () => {
    const p = applyRecordRules(
      plan([
        ["A", "1", "2"],
        ["B", "5", "3"],
      ]),
      [],
      CSV,
      SPEC,
      false,
    );
    expect(p.counts).toMatchObject({ new: 1, errors: 1 });
    const bad = p.rows.find((r) => r.rowNumber === 3)!;
    expect(bad.status).toBe("error");
    expect(bad.messages).toEqual(["Row 3: End is before Start."]);
    expect(p.creates).toEqual([{ name: "A", start: "1", end: "2" }]);
  });

  it("validates an update against the stored record merged with the row", () => {
    seen.length = 0;
    const stored = {
      id: "r1",
      organization: "o1",
      name: "A",
      start: "5",
      end: "6",
      note: "kept",
    };
    // Only End changes, to a value before the stored Start.
    const rows = validateRows(
      { header: ["Name", "End"], rows: [["A", "4"]] },
      CSV,
    );
    if (!rows.ok) throw new Error("bad header");
    const p = applyRecordRules(
      planImport({
        rows: rows.rows,
        existing: [{ id: "r1", values: stored }],
        spec: CSV,
        mode: "update",
      }),
      [stored],
      CSV,
      SPEC,
      false,
    );
    expect(p.counts).toMatchObject({ updated: 0, errors: 1 });
    expect(p.updates).toEqual([]);
    expect(seen[0]).toMatchObject({ note: "kept", start: "5", end: "4" });
    expect(seen[0]).not.toHaveProperty("id");
    expect(seen[0]).not.toHaveProperty("organization");
  });

  it("tags new rows with source import where the collection keeps one", () => {
    seen.length = 0;
    applyRecordRules(plan([["A", "", ""]]), [], CSV, SPEC, true);
    expect(seen[0]).toMatchObject({ source: "import" });
  });

  it("leaves a clean plan unchanged and rethrows non-validation errors", () => {
    const clean = plan([["A", "1", "2"]]);
    expect(applyRecordRules(clean, [], CSV, SPEC, false).counts).toEqual(
      clean.counts,
    );
    const boom: AddonRecordSpec = {
      ...SPEC,
      validate: () => {
        throw new Error("bug");
      },
    };
    expect(() => applyRecordRules(clean, [], CSV, boom, false)).toThrow("bug");
  });
});
