// ONB-01, ONB-03, CONTEXT A3-Q2/Q3: every intake field is required or carries a fallback with
// owner-facing text, and the seven stages run in order.
import { describe, expect, it } from "vitest";
import { INTAKE_FIELDS, STAGES } from "./index";

describe("STAGES (CONTEXT A3-Q2)", () => {
  it("lists the seven stages in order", () => {
    expect(STAGES.map((s) => s.slug)).toEqual([
      "business",
      "contact",
      "email",
      "words",
      "people",
      "look",
      "the-rest",
    ]);
    expect(STAGES.map((s) => s.name)).toEqual([
      "Your business",
      "Contact & hours",
      "Email",
      "Your words & services",
      "People & proof",
      "Photos & look",
      "Domain & the rest",
    ]);
  });
});

describe("INTAKE_FIELDS (ONB-03)", () => {
  it("every field is required XOR has a fallback with non-empty owner text", () => {
    for (const f of INTAKE_FIELDS) {
      const hasFallback = "fallback" in f && f.fallback !== undefined;
      expect(f.required === true || hasFallback, f.id).toBe(true);
      expect(f.required === true && hasFallback, f.id).toBe(false);
      if (hasFallback) {
        expect(f.fallback.ownerText.trim().length, f.id).toBeGreaterThan(0);
      }
    }
  });

  it("ids are unique and anchors are field-<id>", () => {
    const ids = INTAKE_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of INTAKE_FIELDS) expect(f.anchor).toBe(`field-${f.id}`);
  });

  it("every stage has at least one field and every field names a real stage", () => {
    const slugs = STAGES.map((s) => s.slug) as string[];
    for (const s of slugs) {
      expect(
        INTAKE_FIELDS.some((f) => f.stage === s),
        s,
      ).toBe(true);
    }
    for (const f of INTAKE_FIELDS) expect(slugs).toContain(f.stage);
  });

  it("the required ids are exactly the CONTEXT four plus the PD-24 conditionals", () => {
    const required = INTAKE_FIELDS.filter((f) => f.required === true)
      .map((f) => f.id)
      .sort();
    expect(required).toEqual(
      [
        "org_name",
        "path",
        "time_zone",
        "contact_method",
        "photo_descriptions",
        "email_delivery",
      ].sort(),
    );
  });

  it("covers every ONB-01 group", () => {
    const ids = INTAKE_FIELDS.map((f) => f.id);
    for (const id of [
      "tagline",
      "business_type",
      "logo",
      "font_pairing",
      "address",
      "service_area",
      "hours",
      "socials",
      "about",
      "mission",
      "headline",
      "services",
      "team",
      "hero",
      "gallery",
      "moodboard",
      "domain_choice",
      "ga4_id",
      "gbp",
      "legal_name",
      "privacy_contact",
      "legal_region",
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it("uses the UI-SPEC helper copy for the logo fallback", () => {
    const logo = INTAKE_FIELDS.find((f) => f.id === "logo");
    expect(logo && "fallback" in logo ? logo.fallback.ownerText : "").toBe(
      "Leave empty and we'll show your business name in your site's font.",
    );
  });
});
