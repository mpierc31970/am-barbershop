// RFC 4180 CSV parser (ADDON-12, D120). Hand-written single-pass state machine: no dependency,
// linear time (T-05-07), pure and Edge-safe. Tolerates what Excel and Google Sheets write: a
// UTF-8 BOM, CRLF / LF / lone CR line endings, quoted fields with doubled quotes and newlines.

export const MAX_IMPORT_ROWS = 2000;
/** Upload size cap; enforced by callers before the text reaches parseCsv (05-06, 05-08). */
export const MAX_IMPORT_BYTES = 1_500_000;

export type CsvFileError = {
  code:
    | "empty"
    | "not_csv"
    | "unbalanced_quote"
    | "header_only"
    | "too_many_rows"
    | "missing_column"
    | "too_big";
  message: string;
};

export type CsvParseResult =
  | { ok: true; header: string[]; rows: string[][] }
  | { ok: false; error: CsvFileError };

const NOT_CSV =
  'This file isn\'t a CSV. Save it from Excel or Google Sheets as "CSV", then upload it.';

/** 2001 -> "2,001" without Intl (identical on every runtime). */
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function fileError(
  code: CsvFileError["code"],
  count?: number,
): CsvFileError {
  switch (code) {
    case "empty":
      return {
        code,
        message:
          "This file is empty. Add a header row and your rows, then upload it again.",
      };
    case "not_csv":
    case "unbalanced_quote":
      return { code, message: NOT_CSV };
    case "header_only":
      return {
        code,
        message:
          "This file has no rows. Add rows under the header, then upload it again.",
      };
    case "too_many_rows":
      return {
        code,
        message: `This file has ${formatCount(count ?? 0)} rows. Import up to 2,000 at a time: split the file and upload each part.`,
      };
    case "too_big":
      return {
        code,
        message:
          "This file is too big. Split it into smaller files and upload each part.",
      };
    case "missing_column":
      return {
        code,
        message:
          "The file is missing a column. Download the template to see the columns we need.",
      };
  }
}

/** Splits text into records. Returns null when a quoted field never closes. */
function tokenize(text: string): string[][] | null {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false; // inside a quoted field
  let afterQuote = false; // just saw a quote while quoted (either close or first of "")
  let fieldStarted = false; // any char (or quote) seen for the current field

  const endField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  const len = text.length;
  for (let i = 0; i < len; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (afterQuote) {
        afterQuote = false;
        if (ch === '"') {
          field += '"';
          continue;
        }
        quoted = false; // the previous quote closed the field; fall through to unquoted handling
      } else if (ch === '"') {
        afterQuote = true;
        continue;
      } else {
        field += ch;
        continue;
      }
    }
    // unquoted state
    if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r") {
      endRecord();
      if (text[i + 1] === "\n") i++;
    } else if (ch === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else {
      // A stray quote mid-field, or text after a closing quote, is kept literally (Excel-tolerant).
      field += ch;
      fieldStarted = true;
    }
  }
  if (quoted && !afterQuote) return null;
  if (fieldStarted || record.length > 0) endRecord();
  return records;
}

export function parseCsv(text: string): CsvParseResult {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.includes("\u0000"))
    return { ok: false, error: fileError("not_csv") };
  const records = tokenize(body);
  if (records === null)
    return { ok: false, error: fileError("unbalanced_quote") };

  // Blank lines and rows of only empty cells (Excel's trailing ",,,") carry nothing.
  const nonBlank = records.filter((r) => r.some((c) => c !== ""));
  if (nonBlank.length === 0) return { ok: false, error: fileError("empty") };

  const header = nonBlank[0]!;
  const data = nonBlank.slice(1);
  if (data.length === 0) return { ok: false, error: fileError("header_only") };
  if (data.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: fileError("too_many_rows", data.length) };
  }
  const width = header.length;
  const rows = data.map((r) =>
    r.length < width ? [...r, ...Array<string>(width - r.length).fill("")] : r,
  );
  return { ok: true, header, rows };
}
