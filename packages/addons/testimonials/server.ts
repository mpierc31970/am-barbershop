// "./server": the pure block-data transform (ADDON-02, ADDON-08; D253; RESEARCH Pattern 2).
// The platform reads the published, not-held testimonials through the org-scoped chokepoint
// (readPublicAddonRecords: public fields only) and passes them in. Nothing here touches a
// context, env or a client. Erasable TypeScript only, no .tsx in its import chain.
import {
  validateTestimonialsContent,
  type TestimonialsBlockContent,
} from "./sections/definition";

/** What a Testimonials block renders per item (public fields only). */
export type TestimonialView = {
  id: string;
  quote: string;
  author_name: string;
  author_detail: string;
  rating: number | null;
  photo_url: string;
  photo_alt: string;
};

type SectionRef = {
  id: string;
  section_type: string;
  content: Record<string, unknown>;
};

type RecordLike = { id: string } & Record<string, unknown>;

export const blockCollections = ["testimonials"] as const;

const str = (v: unknown) => (typeof v === "string" ? v : "");

function rating(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5
    ? v
    : null;
}

function order(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function settings(content: unknown): TestimonialsBlockContent {
  try {
    return validateTestimonialsContent(content);
  } catch {
    return validateTestimonialsContent({});
  }
}

/** featured first, then sort_order, then id (stable). */
export function orderTestimonials(
  records: readonly RecordLike[],
): RecordLike[] {
  return [...records].sort((a, b) => {
    const fa = a.featured === true ? 0 : 1;
    const fb = b.featured === true ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const d = order(a.sort_order) - order(b.sort_order);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function toView(r: RecordLike): TestimonialView {
  return {
    id: r.id,
    quote: str(r.quote),
    author_name: str(r.author_name),
    author_detail: str(r.author_detail),
    rating: rating(r.rating),
    photo_url: str(r.photo_url),
    photo_alt: str(r.photo_alt),
  };
}

/** Pure: the items one block shows, from its settings and the org's public testimonials. */
export function selectTestimonials(
  content: unknown,
  records: readonly RecordLike[],
): TestimonialView[] {
  const c = settings(content);
  const usable = records.filter(
    (r) => typeof r.id === "string" && str(r.quote).trim() !== "",
  );
  let list = orderTestimonials(usable);
  if (c.show === "featured") list = list.filter((r) => r.featured === true);
  const limit = c.layout === "single" ? 1 : c.limit;
  return list.slice(0, limit).map(toView);
}

/** The contract passes `now` third; testimonials have no schedule, so it is not read. */
export function blockData(
  sections: readonly SectionRef[],
  records: Readonly<Record<string, readonly RecordLike[]>>,
): Record<string, TestimonialView[]> {
  const rows = Object.prototype.hasOwnProperty.call(records, "testimonials")
    ? (records.testimonials ?? [])
    : [];
  const out: Record<string, TestimonialView[]> = {};
  for (const s of sections) {
    if (s.section_type !== "testimonials") continue;
    out[s.id] = selectTestimonials(s.content, rows);
  }
  return out;
}
