// The intake schema (ONB-01, ONB-03, CONTEXT A3-Q3, RESEARCH Pattern 6). Every field is either
// required or carries a fallback with owner-facing text: a field with neither fails the
// `satisfies` below at compile time, and schema.test.ts checks it again at runtime.
//
// Required: business name, path, time zone and one contact method (CONTEXT A3-Q3), plus two
// conditional must-haves from UI-SPEC (PD-24): a saved photo needs a description (D280) and no
// email route may be bouncing (D173). Both are met vacuously when there is nothing to check.
// ownerText is the UI-SPEC helper copy, so the hub and P8 assembly say the same thing.
import type { AddonRegistry } from "../addons/types";
import type { QuoteSelections } from "../pricing/types";
import type { IntakeSnapshot } from "./snapshot";
import type { StageSlug } from "./stages";

export type FallbackRule =
  | "omit"
  | "wordmark"
  | "about-from-type"
  | "cds-writes"
  | "theme-hero"
  | "initials"
  | "contact-for-hours"
  | "cds-choose"
  | "cds-colours"
  | "preview-address"
  | "business-name"
  | "public-email"
  | "address-state"
  | "no-section";

type FieldBase = {
  id: string;
  stage: StageSlug;
  label: string;
  anchor: string;
  present(s: IntakeSnapshot): boolean;
};

export type IntakeField =
  | (FieldBase & { required: true })
  | (FieldBase & {
      required?: false;
      fallback: { rule: FallbackRule; ownerText: string };
    });

const filled = (v: string) => v.trim() !== "";

const FIELDS = [
  // 1 · Your business
  {
    id: "org_name",
    stage: "business",
    label: "Business name",
    anchor: "field-org_name",
    required: true,
    present: (s) => filled(s.orgName),
  },
  {
    id: "path",
    stage: "business",
    label: "Your plan",
    anchor: "field-path",
    required: true,
    present: (s) => s.path !== "",
  },
  {
    id: "tagline",
    stage: "business",
    label: "Tagline",
    anchor: "field-tagline",
    present: (s) => filled(s.profile.tagline),
    fallback: { rule: "omit", ownerText: "Leave empty to skip it." },
  },
  {
    id: "business_type",
    stage: "business",
    label: "What kind of business",
    anchor: "field-business_type",
    present: (s) =>
      filled(s.profile.business_type) || filled(s.profile.business_type_other),
    fallback: {
      rule: "business-name",
      ownerText:
        "Leave it and we use the type you picked on your quote, or just your business name.",
    },
  },
  {
    id: "logo",
    stage: "business",
    label: "Logo",
    anchor: "field-logo",
    present: (s) => s.media.logo,
    fallback: {
      rule: "wordmark",
      ownerText:
        "Leave empty and we'll show your business name in your site's font.",
    },
  },
  {
    id: "font_pairing",
    stage: "business",
    label: "Your site's style",
    anchor: "field-font_pairing",
    present: (s) =>
      filled(s.profile.font_pairing) && s.profile.font_pairing !== "cds-choose",
    fallback: {
      rule: "cds-choose",
      ownerText: "We'll pick fonts that fit your mood board.",
    },
  },
  // 2 · Contact & hours
  {
    id: "contact_method",
    stage: "contact",
    label: "Business phone or email",
    anchor: "field-contact_method",
    required: true,
    present: (s) => filled(s.profile.phone) || filled(s.profile.public_email),
  },
  {
    id: "address",
    stage: "contact",
    label: "Address",
    anchor: "field-address",
    present: (s) =>
      filled(s.profile.address.street) || filled(s.profile.address.city),
    fallback: {
      rule: "omit",
      ownerText: "Leave empty if you don't see customers in person.",
    },
  },
  {
    id: "service_area",
    stage: "contact",
    label: "Service area",
    anchor: "field-service_area",
    present: (s) => filled(s.profile.service_area),
    fallback: {
      rule: "omit",
      ownerText: "Leave empty and your site won't mention a service area.",
    },
  },
  {
    id: "time_zone",
    stage: "contact",
    label: "Time zone",
    anchor: "field-time_zone",
    required: true,
    present: (s) => filled(s.profile.time_zone),
  },
  {
    id: "hours",
    stage: "contact",
    label: "Opening hours",
    anchor: "field-hours",
    present: (s) =>
      s.profile.hours !== null &&
      Object.values(s.profile.hours).some((d) => d.open && d.ranges.length > 0),
    fallback: {
      rule: "contact-for-hours",
      ownerText:
        "Leave all days closed and your site says 'Contact us for hours'.",
    },
  },
  {
    id: "socials",
    stage: "contact",
    label: "Social links",
    anchor: "field-socials",
    present: (s) => s.profile.socials.length > 0,
    fallback: {
      rule: "omit",
      ownerText: "Leave empty and your site won't show social links.",
    },
  },
  // 3 · Email
  {
    id: "email_delivery",
    stage: "email",
    label: "An email address that isn't bouncing",
    anchor: "field-email_delivery",
    required: true,
    present: (s) => s.email.bouncing === 0,
  },
  // 4 · Your words & services
  {
    id: "about",
    stage: "words",
    label: "About your business",
    anchor: "field-about",
    present: (s) => filled(s.profile.about),
    fallback: {
      rule: "about-from-type",
      ownerText:
        "Leave empty and we'll start from your business type and town.",
    },
  },
  {
    id: "mission",
    stage: "words",
    label: "Mission",
    anchor: "field-mission",
    present: (s) => filled(s.profile.mission),
    fallback: { rule: "omit", ownerText: "Leave empty to skip it." },
  },
  {
    id: "headline",
    stage: "words",
    label: "The first line visitors should read",
    anchor: "field-headline",
    present: (s) => filled(s.profile.headline),
    fallback: {
      rule: "cds-writes",
      ownerText: "Leave empty and CDS writes one for you.",
    },
  },
  {
    id: "services",
    stage: "words",
    label: "Services",
    anchor: "field-services",
    present: (s) => s.counts.services > 0,
    fallback: {
      rule: "no-section",
      ownerText: "If you skip it, your site won't show a services section.",
    },
  },
  // 5 · People & proof
  {
    id: "team",
    stage: "people",
    label: "Your team",
    anchor: "field-team",
    present: (s) => s.counts.team > 0,
    fallback: {
      rule: "no-section",
      ownerText: "Leave this empty and your site won't show a team section.",
    },
  },
  // 6 · Photos & look
  {
    id: "hero",
    stage: "look",
    label: "Main photo",
    anchor: "field-hero",
    present: (s) => s.media.hero,
    fallback: {
      rule: "theme-hero",
      ownerText: "Leave empty and we'll use your colours instead of a photo.",
    },
  },
  {
    id: "gallery",
    stage: "look",
    label: "More photos",
    anchor: "field-gallery",
    present: (s) => s.counts.gallery > 0,
    fallback: {
      rule: "omit",
      ownerText: "Leave empty and your site won't show a photo gallery.",
    },
  },
  {
    id: "moodboard",
    stage: "look",
    label: "Mood board",
    anchor: "field-moodboard",
    present: (s) => s.counts.moodboard > 0,
    fallback: { rule: "cds-colours", ownerText: "CDS picks colours with you." },
  },
  {
    id: "photo_descriptions",
    stage: "look",
    label: "Photo descriptions",
    anchor: "field-photo_descriptions",
    required: true,
    present: (s) => s.media.photosMissingAlt === 0,
  },
  // 7 · Domain & the rest
  {
    id: "domain_choice",
    stage: "the-rest",
    label: "Your web address",
    anchor: "field-domain_choice",
    present: (s) =>
      s.answers.domain_choice === "need" ||
      (s.answers.domain_choice === "have" && filled(s.answers.domain)),
    fallback: {
      rule: "preview-address",
      ownerText: "Your site works on its preview address until you choose.",
    },
  },
  {
    id: "ga4_id",
    stage: "the-rest",
    label: "Google Analytics ID",
    anchor: "field-ga4_id",
    present: (s) => filled(s.profile.ga4_id),
    fallback: {
      rule: "omit",
      ownerText: "Only if you already use Google Analytics.",
    },
  },
  {
    id: "gbp",
    stage: "the-rest",
    label: "Google Business Profile",
    anchor: "field-gbp",
    present: (s) => s.answers.gbp !== "",
    fallback: {
      rule: "omit",
      ownerText: "Leave it and CDS asks you about it later.",
    },
  },
  {
    id: "legal_name",
    stage: "the-rest",
    label: "Legal business name",
    anchor: "field-legal_name",
    present: (s) => filled(s.profile.legal_name),
    fallback: {
      rule: "business-name",
      ownerText: "Leave empty and we'll use your business name.",
    },
  },
  {
    id: "privacy_contact",
    stage: "the-rest",
    label: "Privacy contact email",
    anchor: "field-privacy_contact",
    present: (s) => filled(s.profile.privacy_contact),
    fallback: {
      rule: "public-email",
      ownerText: "Leave empty and we'll use your public email.",
    },
  },
  {
    id: "legal_region",
    stage: "the-rest",
    label: "State / country",
    anchor: "field-legal_region",
    present: (s) => filled(s.profile.legal_region),
    fallback: {
      rule: "address-state",
      ownerText: "Leave empty and we'll use the state from your address.",
    },
  },
] as const satisfies readonly IntakeField[];

export const INTAKE_FIELDS: readonly IntakeField[] = Object.freeze(FIELDS);

/**
 * Intake fields contributed by the selected add-ons' manifests (CONTEXT A3-Q5). All sit in
 * "People & proof" and are optional: an add-on with nothing collected shows no section yet.
 */
export function addonIntakeFields(
  registry: AddonRegistry,
  selections: QuoteSelections,
): IntakeField[] {
  const out: IntakeField[] = [];
  const seen = new Set<string>();
  for (const slug of selections.addons) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const m = registry.get(slug);
    const intake = m?.intake;
    if (!m || !intake) continue;
    if (intake.records) {
      const id = `addon_${slug}_records`;
      out.push({
        id,
        stage: "people",
        label: m.name,
        anchor: `field-${id}`,
        present: (s) => (s.addonIntake[slug]?.records ?? 0) > 0,
        fallback: {
          rule: "no-section",
          ownerText: `Leave empty and your site won't show ${m.name} until you add some.`,
        },
      });
    }
    for (const f of intake.fields ?? []) {
      const id = `addon_${slug}_${f.id}`;
      out.push({
        id,
        stage: "people",
        label: f.label,
        anchor: `field-${id}`,
        present: (s) => {
          const v = s.addonIntake[slug]?.fields[f.id];
          if (typeof v === "string") return v.trim() !== "";
          return v !== undefined && v !== null && v !== false;
        },
        fallback: { rule: "no-section", ownerText: f.fallback },
      });
    }
  }
  return out;
}
