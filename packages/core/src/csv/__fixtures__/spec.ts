// Test-only CsvSpec shared by the planner tests (quote, name, optional rating).
import type { CsvSpec } from "../types";

const text = (v: unknown) => (v == null ? "" : String(v));

export const quoteSpec: CsvSpec = {
  collection: "fixture_quotes",
  singular: "testimonial",
  plural: "testimonials",
  naturalKey: ["name", "quote"],
  columns: [
    {
      key: "quote",
      label: "Quote",
      required: true,
      example: "Great service.",
      parse: (raw) =>
        raw.length > 1000
          ? { ok: false, message: "Quote is longer than 1,000 characters." }
          : { ok: true, value: raw },
      format: text,
    },
    {
      key: "name",
      label: "Name",
      required: true,
      example: "Ann",
      parse: (raw) => ({ ok: true, value: raw }),
      format: text,
    },
    {
      key: "rating",
      label: "Rating",
      required: false,
      example: "5",
      parse: (raw) => {
        const t = raw.trim();
        if (t === "") return { ok: true, value: null };
        const n = Number(t);
        return Number.isInteger(n) && n >= 1 && n <= 5
          ? { ok: true, value: n }
          : { ok: false, message: "Rating must be a number from 1 to 5." };
      },
      format: text,
    },
  ],
};
