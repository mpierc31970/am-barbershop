// CSV column contract (ADDON-02, D120; CONTEXT Area 4). Types only: 05-02 implements the
// import/export engine against these. Pure and Edge-safe.

/** Result of parsing one raw cell. `message` is owner-facing copy. */
export type CsvParsed =
  { ok: true; value: unknown } | { ok: false; message: string };

export type CsvColumn = {
  /** Record field the column maps to. */
  key: string;
  /** Header text in the template and export. */
  label: string;
  required: boolean;
  /** Example value shown in the downloadable template. */
  example: string;
  parse(raw: string): CsvParsed;
  format(value: unknown): string;
};

export type CsvSpec = {
  collection: string;
  columns: readonly CsvColumn[];
  /** Columns that identify an existing row (update instead of insert). */
  naturalKey: readonly string[];
  singular: string;
  plural: string;
};
