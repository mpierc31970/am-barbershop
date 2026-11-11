// Testimonial record rules (ADDON-02, ADDON-06, ADDON-08; D248, D270; T-05-31, T-05-35).
// Pure. addonRepo (@cds/db) runs validate on every save and CSV row, then screens textsOf and
// urlsOf. Deny by default: only the fields below survive, unknown keys are dropped, an
// organization key is refused (the org always comes from the context), and every message
// is owner-facing copy ("what + how").
import { InvalidInput } from "@cds/core";
import type { AddonRecordSpec } from "@cds/core/addons";

export const QUOTE_MAX = 1000;
export const NAME_MAX = 120;
export const DETAIL_MAX = 160;
export const PHOTO_URL_MAX = 2000;
export const PHOTO_ALT_MAX = 250;

export const SOURCES = ["manual", "import", "google"] as const;
export type TestimonialSource = (typeof SOURCES)[number];

export const COPY = {
  quoteEmpty: "Quote is empty. Add the testimonial text.",
  quoteLong: "Quote is longer than 1,000 characters.",
  nameEmpty: "Name is empty. Add who said it.",
  nameLong: "Name is longer than 120 characters.",
  detailLong: "About them is longer than 160 characters.",
  rating: "Rating must be a number from 1 to 5.",
  photoUrl: "Photo link must start with https:// or http://.",
  photoLong: "Photo link is longer than 2,000 characters.",
  photoAlt: "Describe the photo for people who can't see it.",
  photoAltLong: "Photo description is longer than 250 characters.",
  organization: "A testimonial can't name an organization.",
  malformed: "That testimonial couldn't be read. Try again.",
} as const;

/** The stored shape of one testimonial (validator output). */
export type TestimonialValues = {
  quote: string;
  author_name: string;
  author_detail: string;
  rating: number | null;
  photo_url: string;
  photo_alt: string;
  source: TestimonialSource;
  featured: boolean;
  is_published: boolean;
};

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

function field(raw: Record<string, unknown>, key: string): unknown {
  return hasOwn(raw, key) ? raw[key] : undefined;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A rating 1..5, null for blank; throws the owner copy otherwise. */
export function parseRating(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new InvalidInput(COPY.rating);
  }
  return n;
}

/** "" or an absolute http(s) URL, stored as typed (trimmed). */
export function parsePhotoUrl(v: unknown): string {
  const s = str(v);
  if (s === "") return "";
  if (s.length > PHOTO_URL_MAX) throw new InvalidInput(COPY.photoLong);
  if (!/^https?:\/\//i.test(s)) throw new InvalidInput(COPY.photoUrl);
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("scheme");
    }
  } catch {
    throw new InvalidInput(COPY.photoUrl);
  }
  return s;
}

function capped(v: unknown, max: number, message: string): string {
  const s = str(v);
  if (s.length > max) throw new InvalidInput(message);
  return s;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function validateTestimonial(raw: unknown): TestimonialValues {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInput(COPY.malformed);
  }
  const r = raw as Record<string, unknown>;
  if (hasOwn(r, "organization")) throw new InvalidInput(COPY.organization);

  const quote = str(field(r, "quote"));
  if (quote === "") throw new InvalidInput(COPY.quoteEmpty);
  if (quote.length > QUOTE_MAX) throw new InvalidInput(COPY.quoteLong);

  const author_name = str(field(r, "author_name"));
  if (author_name === "") throw new InvalidInput(COPY.nameEmpty);
  if (author_name.length > NAME_MAX) throw new InvalidInput(COPY.nameLong);

  const author_detail = capped(
    field(r, "author_detail"),
    DETAIL_MAX,
    COPY.detailLong,
  );
  const rating = parseRating(field(r, "rating"));
  const photo_url = parsePhotoUrl(field(r, "photo_url"));
  const photo_alt = capped(
    field(r, "photo_alt"),
    PHOTO_ALT_MAX,
    COPY.photoAltLong,
  );
  if (photo_url !== "" && photo_alt === "") {
    throw new InvalidInput(COPY.photoAlt);
  }
  const sourceRaw = field(r, "source");
  const source: TestimonialSource = (SOURCES as readonly unknown[]).includes(
    sourceRaw,
  )
    ? (sourceRaw as TestimonialSource)
    : "manual";

  return {
    quote,
    author_name,
    author_detail,
    rating,
    photo_url,
    photo_alt,
    source,
    featured: bool(field(r, "featured"), false),
    is_published: bool(field(r, "is_published"), true),
  };
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

export const TESTIMONIAL_RECORDS: AddonRecordSpec = {
  singular: "testimonial",
  plural: "testimonials",
  validate: (raw) => validateTestimonial(raw),
  textsOf: (v) =>
    [s(v.quote), s(v.author_name), s(v.author_detail), s(v.photo_alt)].filter(
      (t) => t !== "",
    ),
  urlsOf: (v) => [s(v.photo_url)].filter((u) => u !== ""),
  title: (v) => s(v.author_name),
  publishedField: "is_published",
  orderField: "sort_order",
};
