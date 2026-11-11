// Credentials CSV columns (ADDON-12, ADDON-13, D120, D125; CONTEXT A5-Q4). Pure. Each parse
// returns the owner-facing "what + how" message; the shared engine prefixes "Row N: ". Rows
// that parse still go through CREDENTIAL_RECORDS.validate on commit (which also refuses an
// Expires before Issued). Matching falls back to title + issuer.
import type { CsvColumn, CsvParsed, CsvSpec } from "@cds/core/csv";
import { dayOf } from "./expiry";
import {
  CATEGORY_MAX,
  COPY,
  ISSUER_MAX,
  NUMBER_MAX,
  TITLE_MAX,
  parseDate,
  parseVerifyUrl,
} from "./records";

const ok = (value: unknown): CsvParsed => ({ ok: true, value });
const fail = (message: string): CsvParsed => ({ ok: false, message });
const text = (v: unknown) =>
  v === null || v === undefined ? "" : typeof v === "string" ? v : String(v);

function thrownMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function required(max: number, empty: string, long: string) {
  return (raw: string): CsvParsed => {
    const t = raw.trim();
    if (t === "") return fail(empty);
    return t.length > max ? fail(long) : ok(t);
  };
}

function maxText(max: number, message: string) {
  return (raw: string): CsvParsed => {
    const t = raw.trim();
    return t.length > max ? fail(message) : ok(t);
  };
}

function date(message: string) {
  return (raw: string): CsvParsed => {
    try {
      return ok(parseDate(raw, message));
    } catch (e) {
      return fail(thrownMessage(e, message));
    }
  };
}

const YES = new Set(["yes", "y", "true", "1"]);
const NO = new Set(["no", "n", "false", "0"]);

function yesNo(label: string, fallback: boolean) {
  return (raw: string): CsvParsed => {
    const t = raw.trim().toLowerCase();
    if (t === "") return ok(fallback);
    if (YES.has(t)) return ok(true);
    if (NO.has(t)) return ok(false);
    return fail(`${label} must be yes or no.`);
  };
}

const yesNoFormat = (v: unknown) => (v === true ? "yes" : "no");

const columns: readonly CsvColumn[] = [
  {
    key: "title",
    label: "Title",
    required: true,
    example: "Registered Nurse",
    parse: required(TITLE_MAX, COPY.titleEmpty, COPY.titleLong),
    format: text,
  },
  {
    key: "issuer",
    label: "Issued by",
    required: true,
    example: "Texas Board of Nursing",
    parse: required(ISSUER_MAX, COPY.issuerEmpty, COPY.issuerLong),
    format: text,
  },
  {
    key: "category",
    label: "Group",
    required: false,
    example: "Licenses",
    parse: maxText(CATEGORY_MAX, COPY.categoryLong),
    format: text,
  },
  {
    key: "credential_number",
    label: "Number",
    required: false,
    example: "RN123456",
    parse: maxText(NUMBER_MAX, COPY.numberLong),
    format: text,
  },
  {
    key: "show_number",
    label: "Show number",
    required: false,
    example: "no",
    parse: yesNo("Show number", false),
    format: yesNoFormat,
  },
  {
    key: "issued_on",
    label: "Issued",
    required: false,
    example: "2019-06-01",
    parse: date(COPY.issuedDate),
    format: (v) => dayOf(v),
  },
  {
    key: "expires_on",
    label: "Expires",
    required: false,
    example: "2027-03-14",
    parse: date(COPY.expiresDate),
    format: (v) => dayOf(v),
  },
  {
    key: "verify_url",
    label: "Verify link",
    required: false,
    example: "",
    parse: (raw) => {
      try {
        return ok(parseVerifyUrl(raw));
      } catch (e) {
        return fail(thrownMessage(e, COPY.verifyUrl));
      }
    },
    format: text,
  },
  {
    key: "is_published",
    label: "Show on site",
    required: false,
    example: "yes",
    parse: yesNo("Show on site", true),
    format: yesNoFormat,
  },
];

export const CREDENTIALS_CSV: CsvSpec = {
  collection: "credentials",
  columns,
  naturalKey: ["title", "issuer"],
  singular: "credential",
  plural: "credentials",
};
