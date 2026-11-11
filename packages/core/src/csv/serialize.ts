// CSV writer (ADDON-12, D120). UTF-8 BOM so Excel reads accents correctly, CRLF row endings
// (RFC 4180), quoting only when needed, and the formula guard on every cell (T-05-06).
import { guardFormula } from "./formula";
import type { CsvSpec } from "./types";

const BOM = String.fromCharCode(0xfeff);
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function cell(raw: string): string {
  const guarded = guardFormula(raw);
  return NEEDS_QUOTES.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

/** UTF-8 byte order mark that starts every CSV file this engine writes. */
export const CSV_BOM = BOM;

/**
 * One CSV line (no line ending) for streaming writers (LIFE-04): every cell gets the formula
 * guard and RFC 4180 quoting, exactly as serializeCsv does.
 */
export function csvLine(cells: readonly string[]): string {
  return cells.map(cell).join(",");
}

export function serializeCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines = [header, ...rows].map(csvLine);
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** Header labels plus one example row: the downloadable template. */
export function templateCsv(spec: CsvSpec): string {
  return serializeCsv(
    spec.columns.map((c) => c.label),
    [spec.columns.map((c) => c.example)],
  );
}

/** Leading "id" column (so re-import updates instead of duplicating), then every column. */
export function exportCsv(
  spec: CsvSpec,
  records: readonly ({ id: string } & Record<string, unknown>)[],
): string {
  return serializeCsv(
    ["id", ...spec.columns.map((c) => c.label)],
    records.map((r) => [r.id, ...spec.columns.map((c) => c.format(r[c.key]))]),
  );
}
