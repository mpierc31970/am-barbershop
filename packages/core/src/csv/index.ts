// @cds/core/csv: the one shared CSV import/export engine (ADDON-12, ADDON-13, D120, D125, D126).
// Pure and Edge-safe: no node:* imports, no DOM APIs. Exports are guarded against formula
// injection (OWASP "CSV Injection") and the guard is stripped losslessly on import.
export type { CsvColumn, CsvParsed, CsvSpec } from "./types";
export { guardFormula, unguardFormula } from "./formula";
export {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  fileError,
  formatCount,
  parseCsv,
} from "./parse";
export type { CsvFileError, CsvParseResult } from "./parse";
export {
  CSV_BOM,
  csvLine,
  exportCsv,
  serializeCsv,
  templateCsv,
} from "./serialize";
export { mapColumns, validateRows } from "./columns";
export type { ColumnMapping, ValidatedRow, ValidationResult } from "./columns";
export { normalizeKey, planImport, toImportPreview } from "./plan";
export type {
  ExistingRecord,
  ImportMode,
  ImportPlan,
  ImportPreview,
  PlannedRow,
} from "./plan";
