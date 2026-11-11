// Testimonials CSV columns (ADDON-12, ADDON-13, D120, D125). Pure. Each parse returns the
// owner-facing "what + how" message; the shared engine prefixes "Row N: ". Rows that parse
// still go through TESTIMONIAL_RECORDS.validate on commit.
import type { CsvColumn, CsvParsed, CsvSpec } from "@cds/core/csv";
import {
  COPY,
  DETAIL_MAX,
  NAME_MAX,
  PHOTO_ALT_MAX,
  QUOTE_MAX,
  parsePhotoUrl,
  parseRating,
} from "./records";

const ok = (value: unknown): CsvParsed => ({ ok: true, value });
const fail = (message: string): CsvParsed => ({ ok: false, message });
const text = (v: unknown) =>
  v === null || v === undefined ? "" : typeof v === "string" ? v : String(v);

function maxText(max: number, message: string) {
  return (raw: string): CsvParsed => {
    const t = raw.trim();
    return t.length > max ? fail(message) : ok(t);
  };
}

function thrownMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
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
    key: "quote",
    label: "Quote",
    required: true,
    example: "They made our booking page easy for every customer.",
    parse: (raw) => {
      const t = raw.trim();
      if (t === "") return fail(COPY.quoteEmpty);
      return t.length > QUOTE_MAX ? fail(COPY.quoteLong) : ok(t);
    },
    format: text,
  },
  {
    key: "author_name",
    label: "Name",
    required: true,
    example: "Maria L.",
    parse: maxText(NAME_MAX, COPY.nameLong),
    format: text,
  },
  {
    key: "author_detail",
    label: "About them",
    required: false,
    example: "Owner, Rivera Bakery",
    parse: maxText(DETAIL_MAX, COPY.detailLong),
    format: text,
  },
  {
    key: "rating",
    label: "Rating",
    required: false,
    example: "5",
    parse: (raw) => {
      try {
        return ok(parseRating(raw));
      } catch (e) {
        return fail(thrownMessage(e, COPY.rating));
      }
    },
    format: (v) => (typeof v === "number" && v >= 1 && v <= 5 ? String(v) : ""),
  },
  {
    key: "photo_url",
    label: "Photo link",
    required: false,
    example: "",
    parse: (raw) => {
      try {
        return ok(parsePhotoUrl(raw));
      } catch (e) {
        return fail(thrownMessage(e, COPY.photoUrl));
      }
    },
    format: text,
  },
  {
    key: "photo_alt",
    label: "Photo description",
    required: false,
    example: "",
    parse: maxText(PHOTO_ALT_MAX, COPY.photoAltLong),
    format: text,
  },
  {
    key: "featured",
    label: "Featured",
    required: false,
    example: "yes",
    parse: yesNo("Featured", false),
    format: yesNoFormat,
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

export const TESTIMONIALS_CSV: CsvSpec = {
  collection: "testimonials",
  columns,
  naturalKey: ["author_name", "quote"],
  singular: "testimonial",
  plural: "testimonials",
};
