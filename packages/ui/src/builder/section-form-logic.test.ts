// Pure builder logic (03-13; CONT-05, CONT-06, CONT-30; D183, D254; 03-UI-SPEC "Page
// builder" header states, "SectionsList row", "BlockTemplatePicker").
import { describe, expect, it } from "vitest";
import {
  CORE_SECTIONS,
  composeSectionRegistry,
  validateColumnsContent,
  type ColumnsContent,
} from "@cds/core/content";
import {
  ALT_REQUIRED_COPY,
  HELD_LINE,
  attentionLine,
  blockFieldErrors,
  blockLabel,
  firstInvalidField,
  headerState,
  isDirty,
  normalizeBlockContent,
  previewText,
  sameDraft,
} from "./section-form-logic";
import { SUGGESTED_PRESETS } from "./presets";

const registry = composeSectionRegistry(CORE_SECTIONS, []);
const PUBLISHED_AT = "2026-09-12T14:14:00.000Z";

describe("blockLabel", () => {
  it("maps the five core types to their owner words", () => {
    expect(blockLabel("hero")).toBe("Hero");
    expect(blockLabel("text-image")).toBe("Text & image");
    expect(blockLabel("text-only")).toBe("Text");
    expect(blockLabel("cta-banner")).toBe("Call to action");
    expect(blockLabel("columns")).toBe("Columns");
  });

  it("falls back to the registry label, then the type id", () => {
    const withAddon = composeSectionRegistry(CORE_SECTIONS, [
      { ...CORE_SECTIONS[2]!, type: "testimonials", label: "Testimonials" },
    ]);
    expect(blockLabel("testimonials", withAddon)).toBe("Testimonials");
    expect(blockLabel("mystery")).toBe("mystery");
    expect(blockLabel("mystery", registry)).toBe("mystery");
  });
});

describe("previewText", () => {
  it("returns the first heading", () => {
    expect(
      previewText({ content: { heading: "Welcome in", text: "<p>Body</p>" } }),
    ).toBe("Welcome in");
  });

  it("uses the first heading item of a columns block", () => {
    const content: ColumnsContent = {
      columns: [
        { id: "c1", items: [{ id: "t", kind: "text", html: "<p>Intro</p>" }] },
        {
          id: "c2",
          items: [{ id: "h", kind: "heading", text: "Meet Dana", level: 2 }],
        },
      ],
    };
    expect(previewText({ content })).toBe("Meet Dana");
  });

  it("falls back to 60 characters of plain text with an ellipsis", () => {
    const long = "word ".repeat(30).trim();
    const out = previewText({ content: { text: `<p>${long}</p>` } });
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBe(61);
    expect(out).not.toContain("<");
  });

  it("keeps short plain text whole and returns '' for an empty block", () => {
    expect(previewText({ content: { description: "Book a visit" } })).toBe(
      "Book a visit",
    );
    expect(previewText({ content: {} })).toBe("");
    expect(previewText({ content: null })).toBe("");
  });
});

describe("headerState", () => {
  const base = {
    status: "draft" as const,
    published_at: null,
    has_unpublished_changes: false,
  };

  it("never published: Not published yet, Draft, Publish enabled", () => {
    const s = headerState(base);
    expect(s.id).toBe("never");
    expect(s.statusLine).toBe("Not published yet");
    expect(s.badge).toEqual({ tone: "draft", label: "Draft" });
    expect(s.publishLabel).toBe("Publish");
    expect(s.publishDisabled).toBe(false);
  });

  it("published and clean: date line, Published, Publish disabled with a reason", () => {
    const s = headerState(
      {
        status: "published",
        published_at: PUBLISHED_AT,
        has_unpublished_changes: false,
      },
      { timeZone: "UTC" },
    );
    expect(s.id).toBe("clean");
    expect(s.statusLine).toBe("Published 12 Sep, 2:14 pm");
    expect(s.badge).toEqual({ tone: "published", label: "Published" });
    expect(s.publishLabel).toBe("Publish");
    expect(s.publishDisabled).toBe(true);
    expect(s.disabledReason).toBe("No changes to publish");
  });

  it("pending changes: Draft saved line and Publish changes", () => {
    const s = headerState({
      status: "published",
      published_at: PUBLISHED_AT,
      has_unpublished_changes: true,
    });
    expect(s.id).toBe("pending");
    expect(s.statusLine).toBe("Draft saved · Unpublished changes");
    expect(s.badge).toEqual({ tone: "changes", label: "Unpublished changes" });
    expect(s.publishLabel).toBe("Publish changes");
    expect(s.publishDisabled).toBe(false);
  });

  it("held: the review sentence and In review, publish re-runs the scan", () => {
    const s = headerState({
      ...base,
      status: "held",
      has_unpublished_changes: true,
    });
    expect(s.id).toBe("held");
    expect(s.statusLine).toBe(HELD_LINE);
    expect(HELD_LINE).toBe(
      "This page is being reviewed, usually within 2 business days.",
    );
    expect(s.badge).toEqual({ tone: "review", label: "In review" });
    expect(s.publishLabel).toBe("Publish changes");
    expect(s.publishDisabled).toBe(false);
  });

  it("publishing: Publishing… with no badge and the button busy", () => {
    const s = headerState(base, { publishing: true });
    expect(s.id).toBe("publishing");
    expect(s.statusLine).toBe("Publishing…");
    expect(s.badge).toBeNull();
    expect(s.publishing).toBe(true);
  });

  it("a never-published page with saved edits still offers Publish", () => {
    const s = headerState({ ...base, has_unpublished_changes: true });
    expect(s.statusLine).toBe("Draft saved · Unpublished changes");
    expect(s.badge?.label).toBe("Draft");
    expect(s.publishLabel).toBe("Publish");
    expect(s.publishDisabled).toBe(false);
  });
});

describe("SUGGESTED_PRESETS", () => {
  // 07-24: five presets (11-49 adds Bio with photo), any section type, multi-block (full cases in presets.test.ts).
  it("ships the six suggested presets with their tile layouts (D183, D-UI-P7-12)", () => {
    expect(SUGGESTED_PRESETS.map((p) => [p.id, p.thumb])).toEqual([
      ["photo-left-text-right", "40-60"],
      ["three-features", "33-33-33"],
      ["photo-gallery", "full"],
      ["faq", "full"],
      ["contact-form-map", "60-40"],
      ["bio-with-photo", "50-50"],
    ]);
  });

  it("the columns presets build content that validates for its layout", () => {
    for (const p of SUGGESTED_PRESETS.slice(0, 2)) {
      const [block] = p.build();
      expect(block!.section_type).toBe("columns");
      expect(() =>
        validateColumnsContent(block!.content, block!.row_layout),
      ).not.toThrow();
    }
  });

  it("photo left, text right: image | heading + text", () => {
    const c = SUGGESTED_PRESETS[0]!.build()[0]!.content as ColumnsContent;
    expect(c.columns.map((col) => col.items.map((i) => i.kind))).toEqual([
      ["image"],
      ["heading", "text"],
    ]);
  });

  it("three features: heading + text in each of three columns", () => {
    const c = SUGGESTED_PRESETS[1]!.build()[0]!.content as ColumnsContent;
    expect(c.columns).toHaveLength(3);
    for (const col of c.columns) {
      expect(col.items.map((i) => i.kind)).toEqual(["heading", "text"]);
    }
  });

  it("mints fresh ids on every build", () => {
    const a = SUGGESTED_PRESETS[1]!.build()[0]!.content as ColumnsContent;
    const b = SUGGESTED_PRESETS[1]!.build()[0]!.content as ColumnsContent;
    expect(a.columns[0]!.id).not.toBe(b.columns[0]!.id);
    expect(a.columns[0]!.items[0]!.id).not.toBe(b.columns[0]!.items[0]!.id);
  });
});

describe("block form helpers", () => {
  it("normalizeBlockContent empties a blank rich-text field only", () => {
    expect(
      normalizeBlockContent("text-only", { heading: "Hi", text: "<p></p>" }),
    ).toEqual({ heading: "Hi", text: "" });
    expect(normalizeBlockContent("text-only", { text: "<p>Kept</p>" })).toEqual(
      { text: "<p>Kept</p>" },
    );
    const hero = { heading: "<p></p>" };
    expect(normalizeBlockContent("hero", hero)).toBe(hero);
  });

  it("isDirty compares content deeply and ignores key order", () => {
    const saved = {
      type: "hero",
      content: { heading: "A", subtitle: "B" },
      background: "main" as const,
    };
    expect(
      isDirty(saved, {
        content: { subtitle: "B", heading: "A" },
        background: "main",
      }),
    ).toBe(false);
    expect(
      isDirty(saved, {
        content: { heading: "A!", subtitle: "B" },
        background: "main",
      }),
    ).toBe(true);
  });

  it("isDirty sees a background change and treats an emptied editor as clean", () => {
    const saved = {
      type: "text-only",
      content: { heading: "", text: "" },
      background: "main" as const,
    };
    expect(
      isDirty(saved, {
        content: { heading: "", text: "" },
        background: "alternate",
      }),
    ).toBe(true);
    expect(
      isDirty(saved, {
        content: { heading: "", text: "<p></p>" },
        background: "main",
      }),
    ).toBe(false);
  });

  it("blockFieldErrors requires alt text when an image address is set", () => {
    const errors = blockFieldErrors("hero", {
      image_url: "https://example.com/a.jpg",
      image_alt: "",
    });
    expect(errors).toEqual({ image_alt: ALT_REQUIRED_COPY });
    expect(blockFieldErrors("hero", { image_url: "", image_alt: "" })).toEqual(
      {},
    );
  });

  it("blockFieldErrors requires alt text when a hero library image is set (P8)", () => {
    expect(
      blockFieldErrors("hero", {
        image_asset: "abc123def456ghi",
        image_alt: "",
      }),
    ).toEqual({ image_alt: ALT_REQUIRED_COPY });
    expect(
      blockFieldErrors("hero", {
        image_asset: "abc123def456ghi",
        image_alt: "Fresh bread",
      }),
    ).toEqual({});
  });

  it("blockFieldErrors rejects unsafe links and image addresses", () => {
    const errors = blockFieldErrors("hero", {
      cta_primary_link: "javascript:alert(1)",
      image_url: "ftp://x/y.png",
      image_alt: "A",
    });
    expect(Object.keys(errors).sort()).toEqual([
      "cta_primary_link",
      "image_url",
    ]);
    expect(blockFieldErrors("cta-banner", { button_link: "/contact" })).toEqual(
      {},
    );
    expect(blockFieldErrors("text-only", { text: "<p>x</p>" })).toEqual({});
  });

  it("attentionLine counts fields and firstInvalidField follows form order", () => {
    expect(attentionLine({})).toBe("");
    expect(attentionLine({ a: "x" })).toBe("1 field needs attention");
    expect(attentionLine({ a: "x", b: "y" })).toBe("2 fields need attention");
    expect(
      firstInvalidField(["heading", "image_url", "image_alt"], {
        image_alt: "x",
        image_url: "y",
      }),
    ).toBe("image_url");
    expect(firstInvalidField(["heading"], {})).toBeNull();
  });

  it("sameDraft treats arrays in order", () => {
    expect(sameDraft({ l: ["a", "b"] }, { l: ["a", "b"] })).toBe(true);
    expect(sameDraft({ l: ["a", "b"] }, { l: ["b", "a"] })).toBe(false);
  });
});
