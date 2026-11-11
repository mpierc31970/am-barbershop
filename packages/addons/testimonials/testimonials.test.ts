// Testimonials manifest, record rules, CSV spec and block settings (ADDON-02, ADDON-08,
// ADDON-10, ADDON-12; T-05-31, T-05-35).
import { existsSync } from "node:fs";
import path from "node:path";
import { InvalidInput } from "@cds/core";
import { composeAddonRegistry } from "@cds/core/addons";
import { CORE_SECTIONS, composeSectionRegistry } from "@cds/core/content";
import { parseCsv, templateCsv, validateRows } from "@cds/core/csv";
import type { TemplateSlotContribution } from "@cds/core/addons";
import type { TemplateSlotInput } from "@cds/core/templates";
import { describe, expect, it } from "vitest";
import manifest from "./index";
import { TESTIMONIALS_CSV } from "./csv";
import { TESTIMONIAL_RECORDS, validateTestimonial } from "./records";
import {
  testimonialsSection,
  validateTestimonialsContent,
} from "./sections/definition";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const base = { quote: "Lovely bread.", author_name: "Maria L." };
const v = (extra: Record<string, unknown>) =>
  validateTestimonial({ ...base, ...extra });

describe("record rules (validate)", () => {
  it("keeps a clean record with defaults", () => {
    expect(validateTestimonial(base)).toEqual({
      quote: "Lovely bread.",
      author_name: "Maria L.",
      author_detail: "",
      rating: null,
      photo_url: "",
      photo_alt: "",
      source: "manual",
      featured: false,
      is_published: true,
    });
  });

  it("requires a quote and refuses more than 1,000 characters", () => {
    expect(() => v({ quote: "   " })).toThrow(
      "Quote is empty. Add the testimonial text.",
    );
    expect(() => v({ quote: "x".repeat(1001) })).toThrow(
      "Quote is longer than 1,000 characters.",
    );
    expect(v({ quote: "x".repeat(1000) }).quote.length).toBe(1000);
  });

  it("requires a name", () => {
    expect(() => v({ author_name: "" })).toThrow(InvalidInput);
  });

  it("maps a blank rating to null and refuses 0, 6 and text", () => {
    expect(v({ rating: "" }).rating).toBeNull();
    expect(v({ rating: 4 }).rating).toBe(4);
    expect(v({ rating: "5" }).rating).toBe(5);
    for (const bad of [0, 6, "x", 4.5]) {
      expect(() => v({ rating: bad })).toThrow(
        "Rating must be a number from 1 to 5",
      );
    }
  });

  it("allows http(s) photo links only (T-05-31)", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//evil.test/x.png",
      "ftp://x.test/a.png",
    ]) {
      expect(() => v({ photo_url: bad, photo_alt: "A" })).toThrow(
        "Photo link must start with https:// or http://",
      );
    }
    expect(
      v({ photo_url: " https://img.test/a.jpg ", photo_alt: "Maria smiling" })
        .photo_url,
    ).toBe("https://img.test/a.jpg");
  });

  it("requires a photo description when a photo link is set", () => {
    expect(() => v({ photo_url: "https://img.test/a.jpg" })).toThrow(
      "Describe the photo for people who can't see it.",
    );
  });

  it("drops unknown keys and refuses an organization key", () => {
    const out = v({ evil: 1, sort_order: 9, created: "x" }) as Record<
      string,
      unknown
    >;
    expect(out).not.toHaveProperty("evil");
    expect(out).not.toHaveProperty("sort_order");
    expect(() => v({ organization: "orgB" })).toThrow(InvalidInput);
    expect(() => validateTestimonial("nope")).toThrow(InvalidInput);
  });

  it("screens every text and the photo link; title is the name", () => {
    const rec = v({
      author_detail: "Owner",
      photo_url: "https://img.test/a.jpg",
      photo_alt: "Maria",
    });
    expect(TESTIMONIAL_RECORDS.textsOf(rec)).toEqual([
      "Lovely bread.",
      "Maria L.",
      "Owner",
      "Maria",
    ]);
    expect(TESTIMONIAL_RECORDS.urlsOf(rec)).toEqual(["https://img.test/a.jpg"]);
    expect(TESTIMONIAL_RECORDS.title(rec)).toBe("Maria L.");
  });
});

describe("CSV spec", () => {
  it("has the owner's columns and natural key", () => {
    expect(TESTIMONIALS_CSV.columns.map((c) => c.label)).toEqual([
      "Quote",
      "Name",
      "About them",
      "Rating",
      "Photo link",
      "Photo description",
      "Featured",
      "Show on site",
    ]);
    expect(
      TESTIMONIALS_CSV.columns.filter((c) => c.required).map((c) => c.label),
    ).toEqual(["Quote", "Name"]);
    expect(TESTIMONIALS_CSV.naturalKey).toEqual(["author_name", "quote"]);
  });

  it("templateCsv has a header and one example row", () => {
    const lines = templateCsv(TESTIMONIALS_CSV)
      .split(/\r?\n/)
      .filter((l) => l !== "");
    expect(lines).toHaveLength(2);
  });

  it("parses yes/no with Show on site defaulting to yes, and reports row errors", () => {
    const parsed = parseCsv(
      "Quote,Name,Rating,Featured,Show on site\n" +
        "Great,Ann,5,yes,\n" +
        "Fine,Bo,9,maybe,no\n",
    );
    if (!parsed.ok) throw new Error("parse failed");
    const res = validateRows(parsed, TESTIMONIALS_CSV);
    if (!res.ok) throw new Error("validate failed");
    expect(res.rows[0]!.values).toMatchObject({
      quote: "Great",
      author_name: "Ann",
      rating: 5,
      featured: true,
      is_published: true,
    });
    expect(res.rows[1]!.errors).toEqual([
      "Row 3: Rating must be a number from 1 to 5.",
      "Row 3: Featured must be yes or no.",
    ]);
    expect(res.rows[1]!.values.is_published).toBe(false);
  });
});

describe("block settings (section validate, T-05-35)", () => {
  it("clamps layout, show and limit and trims the heading", () => {
    expect(
      validateTestimonialsContent({
        heading: `  ${"h".repeat(200)} `,
        layout: "carousel",
        show: "secret",
        limit: 99,
        extra: "dropped",
      }),
    ).toEqual({
      heading: "h".repeat(120),
      layout: "grid",
      show: "all",
      limit: 12,
    });
    expect(validateTestimonialsContent({ limit: 0 }).limit).toBe(1);
    expect(validateTestimonialsContent({ limit: "3" }).limit).toBe(6);
    expect(
      validateTestimonialsContent({ layout: "single", show: "featured" }),
    ).toMatchObject({ layout: "single", show: "featured" });
    expect(() => validateTestimonialsContent(null)).toThrow(InvalidInput);
  });

  it("textsOf is the heading; urlsOf and refsOf are empty; never the H1 owner", () => {
    const c = testimonialsSection.defaultContent();
    expect(testimonialsSection.textsOf(c)).toEqual(["What people say"]);
    expect(testimonialsSection.urlsOf(c)).toEqual([]);
    expect(testimonialsSection.refsOf(c)).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
    expect(testimonialsSection.headings.ownsH1).toBe(false);
    expect(testimonialsSection.layouts).toEqual(["full"]);
  });
});

describe("manifest", () => {
  it("composes with the real registry and core sections", () => {
    const registry = composeAddonRegistry([manifest], {
      fileExists: (p) => existsSync(path.join(repoRoot, p)),
    });
    const m = registry.get("testimonials")!;
    expect(m.name).toBe("Testimonials");
    expect(m.category).toBe("Reviews");
    expect(m.order).toBe(10);
    expect(m.paths).toEqual(["standard", "studio", "shop"]);
    expect(m.premium).toBeUndefined();
    expect(m.nav).toEqual({
      placement: "tab",
      item: "website",
      label: "Testimonials",
      icon: "MessageSquareQuote",
    });
    expect(registry.ownerOf("testimonials")).toBe("testimonials");
    expect(m).not.toHaveProperty("price");
    const sections = composeSectionRegistry(CORE_SECTIONS, registry.sections());
    expect(sections.get("testimonials")?.label).toBe("Testimonials");
  });

  it("seeds a /testimonials page with one valid Testimonials block and retains on removal", () => {
    expect(manifest.install.page?.slug).toBe("testimonials");
    expect(manifest.install.page?.sections).toHaveLength(1);
    const seed = manifest.install.page!.sections[0]!;
    expect(seed.section_type).toBe("testimonials");
    expect(testimonialsSection.validate(seed.content, "full")).toEqual(
      seed.content,
    );
    expect(manifest.install.records?.collection).toBe("testimonials");
    expect(manifest.uninstall.retain).toBe("all");
  });

  it("points training at the Testimonials how-to", () => {
    expect(manifest.training).toEqual([
      expect.objectContaining({
        id: "addon-testimonials",
        howTo: "docs/how-to/addon-testimonials.md",
        video: null,
      }),
    ]);
    expect(
      existsSync(path.join(repoRoot, "docs/how-to/addon-testimonials.md")),
    ).toBe(true);
  });
});

describe("templateSlots (08-07, CONTEXT A1-Q4)", () => {
  it("contributes its own block to the proof slot only", () => {
    const slots: readonly TemplateSlotContribution[] =
      manifest.templateSlots ?? [];
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      slot: "proof",
      section_type: "testimonials",
    });
    expect(slots[0]?.page).toBeUndefined();
  });

  it("contribution content passes the section's own validator unchanged", () => {
    const slots: readonly TemplateSlotContribution[] =
      manifest.templateSlots ?? [];
    const content = slots[0]?.content({} as TemplateSlotInput);
    expect(validateTestimonialsContent(content)).toEqual(content);
  });
});

describe("privacyClauses (09-11, CONTEXT A5-Q1)", () => {
  it("declares one clause for testimonials", () => {
    const clauses = manifest.privacyClauses ?? [];
    expect(clauses.map((c) => c.id)).toEqual(["testimonials"]);
    expect(clauses[0]!.heading).toBe("Testimonials");
    expect(clauses[0]!.what).toMatch(/names/i);
    expect(clauses[0]!.what).toMatch(/photo/i);
    expect(clauses[0]!.howLong).toMatch(/remove/i);
  });
});
