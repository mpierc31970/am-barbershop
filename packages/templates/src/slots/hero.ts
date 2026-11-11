// P8 (08-13) Home slot 1 `hero` (08-UI-SPEC Home row 1; TMPL-01, TMPL-02; D-UI-P8-1..-4,
// CONTEXT A3-Q5, A4-Q2). The registered Hero block's defaults with intake overrides:
// H1 = business name (no accent), sub-line from the CopyWriter, "Serving {area}" trust line,
// intake hero photo by media id with the intake's own alt, Get in touch -> the contact form
// anchor, Call {phone} -> tel:. No photo -> the text-only Hero (Default used). Never left out.
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { readFacts } from "../facts";
import { telHref } from "../html";
import { defaultsOf, unreviewedIds } from "./shared";

export const heroSlot: Slot = {
  name: "hero",
  label: SLOT_LABELS.hero!,
  fill(intake, env) {
    const f = readFacts(intake);
    const content: Record<string, unknown> = {
      ...defaultsOf("hero"),
      // The page's one H1 is never empty (IN-B05): a missing name gives "Welcome", reported.
      heading: f.businessName !== "" ? f.businessName : "Welcome",
      heading_accent: "",
      subtitle: env.copy.heroSubtitle(f),
      cta_primary_text: "Get in touch",
      // D-UI-P8-4: a fixed site path to the form itself (passes safeHref; T-08-13-02). The
      // anchor is the form ITEM wrapper `form-<itemId>` the Contact slot places on this page
      // (07 choice 2; G1, CR-B01), never the form record id.
      cta_primary_link: `/#form-${env.refs.contactFormItemId}`,
    };
    if (f.serviceArea !== "") content.trust_text = `Serving ${f.serviceArea}`;
    const tel = telHref(f.phone);
    if (tel !== "") {
      content.cta_secondary_text = `Call ${f.phone}`;
      content.cta_secondary_link = tel;
    }
    const photo = f.heroAsset;
    // A hero photo saves only with a description (validateHero, WR-B03) and alt is never
    // invented: an undescribed main photo gives the text-only hero, and its id is still
    // reported so the photo polish line asks for the description.
    const placed = photo && photo.alt.trim() !== "" ? photo : null;
    if (placed) {
      content.image_asset = placed.id;
      content.image_alt = placed.alt;
    }
    const notes: string[] = [];
    if (f.businessName === "")
      notes.push('No business name: heading "Welcome"');
    if (!placed) {
      notes.push(
        photo
          ? "Main photo has no description: text-only hero"
          : "No main photo: text-only hero",
      );
    }
    const note = notes.join("; ");
    return {
      blocks: [{ section_type: "hero", row_layout: "full", content }],
      source: placed && f.businessName !== "" ? "provided" : "fallback",
      ...(note ? { note } : {}),
      unreviewedAlt: unreviewedIds([photo]),
    };
  },
};
