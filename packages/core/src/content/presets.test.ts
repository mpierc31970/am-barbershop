// Suggested presets (07-24; D183, D-UI-P7-12, choices 8-9; T-07-24-05).
// Moved from @cds/ui in 08-01 (CONTEXT A1-Q3); email line added (D-UI-P8-8).
import { describe, expect, it } from "vitest";
import { defaultMapBlock, type FaqBlockContent } from "./blocks";
import { CORE_SECTIONS } from "./registry";
import type { ColumnsContent } from "./types";
import { SUGGESTED_PRESETS, faqStartersFor } from "./presets";

const byId = (id: string) => SUGGESTED_PRESETS.find((p) => p.id === id)!;
const defOf = (type: string) => CORE_SECTIONS.find((d) => d.type === type)!;

function ids(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => ids(v, out));
  else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "id" && typeof v === "string") out.push(v);
      else ids(v, out);
    }
  }
  return out;
}

describe("SUGGESTED_PRESETS", () => {
  it("lists six presets in order", () => {
    expect(SUGGESTED_PRESETS.map((p) => p.id)).toEqual([
      "photo-left-text-right",
      "three-features",
      "photo-gallery",
      "faq",
      "contact-form-map",
      "bio-with-photo",
    ]);
  });

  it("bio with photo: one full-width Text & image block headed 'About me' (11-49, D257)", () => {
    const p = byId("bio-with-photo");
    expect(p.title).toBe("Bio with photo");
    const blocks = p.build();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      section_type: "text-image",
      row_layout: "full",
      content: { heading: "About me", image_url: "", text: "" },
    });
    const def = defOf("text-image");
    expect(def.label).toBe("Text & image");
    // Validates as-is, and the saved shape has only the block's own fields (no style keys).
    const saved = def.validate(blocks[0]!.content, "full") as Record<
      string,
      unknown
    >;
    expect(Object.keys(saved).sort()).toEqual(
      [
        "cta_link",
        "cta_text",
        "heading",
        "image_alt",
        "image_url",
        "list_items",
        "phone",
        "quote",
        "text",
      ].sort(),
    );
    // A smuggled style/html field is dropped by the validator, never stored (DASH-04).
    const smuggled = def.validate(
      {
        ...(blocks[0]!.content as object),
        style: "color:red",
        html: "<b>x</b>",
      },
      "full",
    ) as Record<string, unknown>;
    expect(smuggled).not.toHaveProperty("style");
    expect(smuggled).not.toHaveProperty("html");
    // Full width only (invariant 6): a split layout is refused.
    expect(def.layouts).toEqual(["full"]);
  });

  it("every block validates through its registry definition", () => {
    const ctx = {
      addressText: "12 Main St",
      phone: "512",
      businessType: "barber",
      formId: "frm123456789012",
    };
    for (const p of SUGGESTED_PRESETS) {
      const blocks = p.build(ctx);
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      for (const b of blocks) {
        expect(() =>
          defOf(b.section_type).validate(b.content, b.row_layout),
        ).not.toThrow();
      }
    }
  });

  it("two builds share no ids", () => {
    for (const p of SUGGESTED_PRESETS) {
      const a = ids(p.build());
      const b = new Set(ids(p.build()));
      for (const id of a) expect(b.has(id)).toBe(false);
    }
  });

  it("photo gallery: one mosaic gallery headed 'Our work' with no images", () => {
    const blocks = byId("photo-gallery").build();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      section_type: "gallery",
      row_layout: "full",
      content: { display: "mosaic", heading: "Our work" },
    });
    const content = blocks[0]!.content as { images?: unknown[] };
    expect(content.images ?? []).toEqual([]);
  });

  it("faq: three starter questions with empty answers", () => {
    const [block] = byId("faq").build();
    const c = block!.content as FaqBlockContent;
    expect(block!.section_type).toBe("faq");
    expect(c.heading).toBe("Questions and answers");
    expect(c.items.map((i) => i.question)).toEqual([
      "How do I book?",
      "Where are you?",
      "What does it cost?",
    ]);
    expect(c.items.every((i) => i.answer === "")).toBe(true);
  });

  it("contact form and map: columns 60-40 with the form, then a map", () => {
    const blocks = byId("contact-form-map").build({
      addressText: "12 Main St, Austin",
      phone: "512-555-0100",
    });
    expect(blocks.map((b) => [b.section_type, b.row_layout])).toEqual([
      ["columns", "60-40"],
      ["map", "full"],
    ]);
    const cols = blocks[0]!.content as ColumnsContent;
    expect(cols.columns[0]!.items.map((i) => i.kind)).toEqual([
      "heading",
      "text",
      "form",
    ]);
    expect(cols.columns[0]!.items[0]).toMatchObject({ text: "Get in touch" });
    // No form in the context: the builder creates a contact form before inserting.
    expect(cols.columns[0]!.items[2]).toMatchObject({ form_id: "" });
    const withForm = byId("contact-form-map").build({ formId: "frm1" })[0]!
      .content as ColumnsContent;
    expect(withForm.columns[0]!.items[2]).toMatchObject({ form_id: "frm1" });
    // A given form item id is used verbatim (the hero anchors `form-<itemId>`, CR-B01).
    const withItem = byId("contact-form-map").build({
      formId: "frm1",
      formItemId: "item-1",
    })[0]!.content as ColumnsContent;
    expect(withItem.columns[0]!.items[2]).toMatchObject({
      id: "item-1",
      kind: "form",
      form_id: "frm1",
    });
    expect(cols.columns[1]!.items).toMatchObject([
      { kind: "text", html: "<p>12 Main St, Austin</p>" },
      {
        kind: "button",
        text: "512-555-0100",
        link: "tel:5125550100",
        style: "secondary",
        action: "link",
      },
    ]);
    expect(blocks[1]!.content).toEqual(defaultMapBlock());
  });

  it("the stored block keeps the tel: and mailto: links (WR-B01, UI-SPEC Home row 6)", () => {
    const [b] = byId("contact-form-map").build({
      phone: "(512) 555-0100 ext. 4",
      email: "hello@rivera.test",
      formId: "frm123456789012",
    });
    const saved = defOf("columns").validate(
      b!.content,
      b!.row_layout,
    ) as ColumnsContent;
    const links = saved.columns[1]!.items.map((i) =>
      i.kind === "button" ? i.link : "",
    );
    expect(links).toEqual(["tel:5125550100;ext=4", "mailto:hello@rivera.test"]);
    // No anchors left in rich text for the sanitizer to unwrap.
    expect(JSON.stringify(saved)).not.toContain("<a ");
  });

  it("contact preset without business details points to Settings", () => {
    const cols = byId("contact-form-map").build()[0]!.content as ColumnsContent;
    expect(cols.columns[1]!.items[0]).toMatchObject({
      html: "<p>Add your address and phone in Settings › Business info.</p>",
    });
  });

  it("contact preset lists phone and a mailto line; no Settings helper when email is known (D-UI-P8-8)", () => {
    const cols = byId("contact-form-map").build({
      phone: "512-555-0100",
      email: "hello@rivera.test",
    })[0]!.content as ColumnsContent;
    const json = JSON.stringify(cols.columns[1]!.items);
    expect(json).toContain('"link":"tel:5125550100"');
    expect(json).toContain('"link":"mailto:hello@rivera.test"');
    expect(json).not.toContain("Add your address and phone in Settings");
  });

  it("contact preset with only an email still skips the helper line", () => {
    const cols = byId("contact-form-map").build({ email: "a@b.test" })[0]!
      .content as ColumnsContent;
    expect(cols.columns[1]!.items).toMatchObject([
      { kind: "button", text: "a@b.test", link: "mailto:a@b.test" },
    ]);
    expect(JSON.stringify(cols.columns[1]!.items)).not.toContain("Settings");
  });

  it("contact intro uses the UI-SPEC wording", () => {
    const cols = byId("contact-form-map").build()[0]!.content as ColumnsContent;
    const intro = (cols.columns[0]!.items[1] as { html: string }).html;
    expect(intro).toContain("Send us a message and we'll get back to you.");
    expect(intro).not.toContain("we will get back to you");
  });

  it("a hostile email never becomes markup (T-08-01-01)", () => {
    const cols = byId("contact-form-map").build({
      email: "<script>alert(1)</script>@x.test",
      formId: "frm123456789012",
    })[0]!.content as ColumnsContent;
    // Plain button text (React escapes it) and a mailto: link; no rich-text item at all.
    expect(cols.columns[1]!.items.every((i) => i.kind === "button")).toBe(true);
    const saved = defOf("columns").validate(cols, "60-40") as ColumnsContent;
    const btn = saved.columns[1]!.items[0] as { link: string };
    expect(btn.link.startsWith("mailto:")).toBe(true);
    expect(btn.link).not.toContain("<script");
  });

  it("escapes hostile address text (T-07-24-05)", () => {
    const cols = byId("contact-form-map").build({ addressText: "<b>&" })[0]!
      .content as ColumnsContent;
    expect(cols.columns[1]!.items[0]).toMatchObject({
      html: "<p>&lt;b&gt;&amp;</p>",
    });
  });
});

describe("faqStartersFor", () => {
  it("studio types get the studio set", () => {
    expect(faqStartersFor("hair-salon")).toEqual([
      "How do I book?",
      "Do you take walk-ins?",
      "What is your cancellation policy?",
    ]);
  });
  it("types recommending appointments get the practice set", () => {
    expect(faqStartersFor("therapist")[0]).toBe(
      "How do I make an appointment?",
    );
  });
  it("unknown or blank gets the default set", () => {
    const d = ["How do I book?", "Where are you?", "What does it cost?"];
    expect(faqStartersFor("")).toEqual(d);
    expect(faqStartersFor("nope")).toEqual(d);
    expect(faqStartersFor(undefined)).toEqual(d);
    expect(faqStartersFor("other")).toEqual(d);
  });
});
