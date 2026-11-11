// Business types for "What kind of business?" (ONB-11, D176, D177, D215, D268). Data, not
// code (invariant 2). Each type names the add-ons recommended for it; slugs that are not
// installed yet (v1.1 add-ons such as appointments, events, studio-booking, newsletter) are
// skipped silently by pickableAddons until their package ships. `aup: "review"` marks the
// reviewed-first categories of ACCEPTABLE-USE.md (D215). `aboutSeed` feeds the P8 About
// fallback: {name} and {city} are filled from the intake.
import type { AddonPath } from "../addons/constants";

export type AupFlag = "ok" | "review";

/** P8 (08-06, D-UI-P8-10): which phrase row of the assembly copy table a type uses. */
export type CopyGroup =
  "practice" | "shop" | "service" | "studio" | "community" | "other";

export const COPY_GROUPS: readonly CopyGroup[] = Object.freeze([
  "practice",
  "shop",
  "service",
  "studio",
  "community",
  "other",
]);

export type BusinessType = {
  id: string;
  label: string;
  copyGroup: CopyGroup;
  /** Lower-case plural for the "Recommended for {plural}" heading. */
  plural: string;
  paths: readonly AddonPath[];
  recommended: readonly string[];
  aup: AupFlag;
  aboutSeed: string;
};

type Seed = Omit<BusinessType, "paths" | "aup"> & { aup?: AupFlag };

const standard = (s: Seed): BusinessType => ({
  ...s,
  aup: s.aup ?? "ok",
  paths: ["standard"],
});
const studio = (s: Seed): BusinessType => ({
  ...s,
  aup: s.aup ?? "ok",
  paths: ["studio"],
});

// Practitioners book one person (Appointments); venues run classes (Events).
const PRACTICE = ["appointments", "testimonials", "credentials", "newsletter"];
const SHOP = ["testimonials", "newsletter", "events"];
const SERVICE = ["testimonials", "credentials", "newsletter"];
const SALON = ["studio-booking", "testimonials", "newsletter"];

const STANDARD_TYPES: readonly BusinessType[] = [
  standard({
    id: "therapist",
    label: "Therapist",
    copyGroup: "practice",
    plural: "therapists",
    recommended: PRACTICE,
    aboutSeed: "{name} is a therapy practice in {city}.",
  }),
  standard({
    id: "counselor",
    label: "Counselor",
    copyGroup: "practice",
    plural: "counselors",
    recommended: PRACTICE,
    aboutSeed: "{name} is a counseling practice in {city}.",
  }),
  standard({
    id: "coach",
    label: "Coach",
    copyGroup: "practice",
    plural: "coaches",
    recommended: ["appointments", "testimonials", "events", "newsletter"],
    aboutSeed: "{name} is a coaching practice in {city}.",
  }),
  standard({
    id: "consultant",
    label: "Consultant",
    copyGroup: "practice",
    plural: "consultants",
    recommended: ["appointments", "testimonials", "credentials"],
    aboutSeed: "{name} is a consulting business in {city}.",
  }),
  standard({
    id: "tutor",
    label: "Tutor",
    copyGroup: "practice",
    plural: "tutors",
    recommended: ["appointments", "testimonials", "credentials"],
    aboutSeed: "{name} offers tutoring in {city}.",
  }),
  standard({
    id: "personal-trainer",
    label: "Personal trainer",
    copyGroup: "practice",
    plural: "personal trainers",
    recommended: ["appointments", "testimonials", "credentials"],
    aboutSeed: "{name} is a personal training business in {city}.",
  }),
  standard({
    id: "yoga-studio",
    label: "Yoga studio",
    copyGroup: "studio",
    plural: "yoga studios",
    recommended: ["events", "testimonials", "newsletter"],
    aboutSeed: "{name} is a yoga studio in {city}.",
  }),
  standard({
    id: "photographer",
    label: "Photographer",
    copyGroup: "practice",
    plural: "photographers",
    recommended: ["appointments", "testimonials"],
    aboutSeed: "{name} is a photography business in {city}.",
  }),
  standard({
    id: "accountant",
    label: "Accountant",
    copyGroup: "practice",
    plural: "accountants",
    recommended: ["appointments", "credentials", "testimonials"],
    aboutSeed: "{name} is an accounting practice in {city}.",
  }),
  standard({
    id: "cleaning-service",
    label: "Cleaning service",
    copyGroup: "service",
    plural: "cleaning services",
    recommended: SERVICE,
    aboutSeed: "{name} is a cleaning service in {city}.",
  }),
  standard({
    id: "home-services",
    label: "Contractor or trade",
    copyGroup: "service",
    plural: "contractors and trades",
    recommended: SERVICE,
    aboutSeed: "{name} is a home services business in {city}.",
  }),
  standard({
    id: "bakery",
    label: "Bakery",
    copyGroup: "shop",
    plural: "bakeries",
    recommended: SHOP,
    aboutSeed: "{name} is a family bakery in {city}.",
  }),
  standard({
    id: "restaurant",
    label: "Restaurant or cafe",
    copyGroup: "shop",
    plural: "restaurants and cafes",
    recommended: SHOP,
    aboutSeed: "{name} is a restaurant in {city}.",
  }),
  standard({
    id: "retail-store",
    label: "Shop or store",
    copyGroup: "shop",
    plural: "shops and stores",
    recommended: SHOP,
    aboutSeed: "{name} is a local store in {city}.",
  }),
  standard({
    id: "paint-store",
    label: "Paint store",
    copyGroup: "shop",
    plural: "paint stores",
    recommended: ["testimonials", "newsletter"],
    aboutSeed: "{name} is a paint store in {city}.",
  }),
  standard({
    id: "nonprofit",
    label: "Nonprofit",
    copyGroup: "community",
    plural: "nonprofits",
    recommended: ["events", "newsletter", "testimonials"],
    aboutSeed: "{name} is a nonprofit serving {city}.",
  }),
  standard({
    id: "event-host",
    label: "Workshops and events",
    copyGroup: "community",
    plural: "event hosts",
    recommended: ["events", "newsletter", "testimonials"],
    aboutSeed: "{name} hosts workshops and events in {city}.",
  }),
  standard({
    id: "astrologer-psychic",
    label: "Astrologer, psychic or tarot reader",
    copyGroup: "practice",
    plural: "astrologers and psychic readers",
    recommended: ["appointments", "testimonials", "newsletter"],
    aup: "review",
    aboutSeed: "{name} offers readings in {city}.",
  }),
  standard({
    id: "cbd-shop",
    label: "CBD or hemp shop",
    copyGroup: "shop",
    plural: "CBD and hemp shops",
    recommended: ["testimonials", "newsletter"],
    aup: "review",
    aboutSeed: "{name} is a CBD shop in {city}.",
  }),
  standard({
    id: "financial-advisor",
    label: "Financial advisor",
    copyGroup: "practice",
    plural: "financial advisors",
    recommended: ["appointments", "credentials", "testimonials"],
    aup: "review",
    aboutSeed: "{name} is a financial advice practice in {city}.",
  }),
];

const STUDIO_TYPES: readonly BusinessType[] = [
  studio({
    id: "hair-salon",
    label: "Hair salon",
    copyGroup: "studio",
    plural: "hair salons",
    recommended: SALON,
    aboutSeed: "{name} is a hair salon in {city}.",
  }),
  studio({
    id: "barber",
    label: "Barbershop",
    copyGroup: "studio",
    plural: "barbershops",
    recommended: SALON,
    aboutSeed: "{name} is a barbershop in {city}.",
  }),
  studio({
    id: "nail-salon",
    label: "Nail salon",
    copyGroup: "studio",
    plural: "nail salons",
    recommended: SALON,
    aboutSeed: "{name} is a nail salon in {city}.",
  }),
  studio({
    id: "lash-studio",
    label: "Lash studio",
    copyGroup: "studio",
    plural: "lash studios",
    recommended: SALON,
    aboutSeed: "{name} is a lash studio in {city}.",
  }),
  studio({
    id: "brow-bar",
    label: "Brow bar",
    copyGroup: "studio",
    plural: "brow bars",
    recommended: SALON,
    aboutSeed: "{name} is a brow bar in {city}.",
  }),
  studio({
    id: "esthetician",
    label: "Esthetician or skin studio",
    copyGroup: "studio",
    plural: "skin studios",
    recommended: [
      "studio-booking",
      "testimonials",
      "credentials",
      "newsletter",
    ],
    aboutSeed: "{name} is a skin care studio in {city}.",
  }),
  studio({
    id: "day-spa",
    label: "Day spa",
    copyGroup: "studio",
    plural: "day spas",
    recommended: SALON,
    aboutSeed: "{name} is a day spa in {city}.",
  }),
  studio({
    id: "massage",
    label: "Massage studio",
    copyGroup: "studio",
    plural: "massage studios",
    recommended: ["studio-booking", "testimonials", "credentials"],
    aboutSeed: "{name} is a massage studio in {city}.",
  }),
  studio({
    id: "tattoo",
    label: "Tattoo or piercing studio",
    copyGroup: "studio",
    plural: "tattoo studios",
    recommended: SALON,
    aboutSeed: "{name} is a tattoo studio in {city}.",
  }),
  studio({
    id: "med-spa",
    label: "Med spa",
    copyGroup: "studio",
    plural: "med spas",
    recommended: ["studio-booking", "credentials", "testimonials"],
    aup: "review",
    aboutSeed: "{name} is a med spa in {city}.",
  }),
  studio({
    id: "wellness-clinic",
    label: "Wellness clinic",
    copyGroup: "studio",
    plural: "wellness clinics",
    recommended: ["studio-booking", "credentials", "testimonials"],
    aboutSeed: "{name} is a wellness clinic in {city}.",
  }),
  studio({
    id: "pet-grooming",
    label: "Pet grooming",
    copyGroup: "studio",
    plural: "pet groomers",
    recommended: SALON,
    aboutSeed: "{name} is a pet grooming studio in {city}.",
  }),
];

const OTHER: BusinessType = Object.freeze<BusinessType>({
  id: "other",
  label: "Something else",
  copyGroup: "other",
  plural: "your business",
  paths: ["standard", "studio"],
  recommended: [],
  aup: "ok",
  aboutSeed: "{name} is a local business in {city}.",
});

export const BUSINESS_TYPES: readonly BusinessType[] = Object.freeze([
  ...STANDARD_TYPES,
  ...STUDIO_TYPES,
  OTHER,
]);

/** Types for one path, in data order, "Something else" last. */
export function businessTypesFor(path: AddonPath): readonly BusinessType[] {
  return BUSINESS_TYPES.filter((t) => t.paths.includes(path));
}

export function findBusinessType(id: unknown): BusinessType | undefined {
  if (typeof id !== "string") return undefined;
  return BUSINESS_TYPES.find((t) => t.id === id);
}
