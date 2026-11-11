// Column mapping and row validation (ADDON-12, D120). Headers match column labels (or keys)
// case-insensitively after trim; unknown headers are ignored and reported (T-05-08: only
// spec.columns keys ever reach values). Every row error is owner-facing "Row N: what + how".
import { unguardFormula } from "./formula";
import type { CsvFileError } from "./parse";
import type { CsvSpec } from "./types";

export type ColumnMapping =
  | {
      ok: true;
      index: Record<string, number>;
      idIndex: number | null;
      ignored: string[];
    }
  | { ok: false; error: CsvFileError };

export type ValidatedRow = {
  /** Spreadsheet row number: data index + 2 (row 1 is the header). */
  rowNumber: number;
  id: string | null;
  values: Record<string, unknown>;
  errors: string[];
};

export type ValidationResult =
  | { ok: true; rows: ValidatedRow[]; ignored: string[] }
  | { ok: false; error: CsvFileError };

const norm = (s: string) =>
  s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

export function mapColumns(header: string[], spec: CsvSpec): ColumnMapping {
  const byName = new Map<string, string>();
  for (const c of spec.columns) {
    byName.set(norm(c.label), c.key);
    if (!byName.has(norm(c.key))) byName.set(norm(c.key), c.key);
  }
  const index: Record<string, number> = {};
  let idIndex: number | null = null;
  const ignored: string[] = [];

  header.forEach((raw, i) => {
    const h = norm(unguardFormula(raw));
    if (h === "") return;
    if (h === "id" && idIndex === null && !byName.has("id")) {
      idIndex = i;
      return;
    }
    const key = byName.get(h);
    if (key !== undefined && !Object.hasOwn(index, key)) index[key] = i;
    else ignored.push(raw.trim());
  });

  const missing = spec.columns.find(
    (c) => c.required && !Object.hasOwn(index, c.key),
  );
  if (missing) {
    return {
      ok: false,
      error: {
        code: "missing_column",
        message: `The file is missing the ${missing.label} column. Download the template to see the columns we need.`,
      },
    };
  }
  return { ok: true, index, idIndex, ignored };
}

export function validateRows(
  parsed: { header: string[]; rows: string[][] },
  spec: CsvSpec,
): ValidationResult {
  const mapping = mapColumns(parsed.header, spec);
  if (!mapping.ok) return mapping;
  const { index, idIndex, ignored } = mapping;

  const rows = parsed.rows.map((cells, i): ValidatedRow => {
    const rowNumber = i + 2;
    const rawId =
      idIndex === null ? "" : unguardFormula(cells[idIndex] ?? "").trim();
    const values: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const col of spec.columns) {
      const at = index[col.key];
      if (at === undefined) continue; // optional column absent from the file: left untouched
      const raw = unguardFormula(cells[at] ?? "");
      if (col.required && raw.trim() === "") {
        errors.push(`Row ${rowNumber}: ${col.label} is empty.`);
        continue;
      }
      const result = col.parse(raw);
      if (result.ok) values[col.key] = result.value;
      else errors.push(`Row ${rowNumber}: ${result.message}`);
    }
    return { rowNumber, id: rawId === "" ? null : rawId, values, errors };
  });
  return { ok: true, rows, ignored };
}
