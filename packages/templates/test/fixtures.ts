// Mirrors seedCompleteIntake / seedMinimalIntake through getIntakeForAssembly (08-01 shape).
// 08-16 asserts these equal the real seeded output field by field, including media alt;
// update both together.
//
// Pure objects typed AssemblyIntake, so a contract drift fails typecheck. Record and media ids
// are stable stand-ins (the real seed mints PocketBase ids); compare by position, not id.
// moodboardProposal is null here: the real seed computes it from generated mood-board image
// colours, and no template slot reads it (08-16 skips that key).
import type {
  AssemblyIntake,
  AssemblyMediaRef,
  AssemblyService,
  AssemblyTeamMember,
} from "@cds/core/templates";

const p = <T>(value: T) => ({ value, source: "provided" as const });
const fb = <T>(value: T) => ({ value, source: "fallback" as const });

/** alt_reviewed is true exactly when the intake description is non-empty (08-01 step 8). */
const ref = (id: string, alt: string): AssemblyMediaRef => ({
  id,
  alt,
  alt_reviewed: alt !== "",
});

const OPEN = (start: string, end: string) => ({
  open: true,
  ranges: [{ start, end }],
});
const CLOSED = { open: false, ranges: [] };

const LOGO = ref("mediarvlogo0001", "Rivera Bakery logo");
const HERO = ref(
  "mediarvhero0001",
  "Fresh loaves cooling on the bakery counter",
);
const GALLERY: readonly AssemblyMediaRef[] = [
  ref("mediarvgall0001", "Sourdough loaves with a dark crust"),
  ref("mediarvgall0002", "A three-tier celebration cake"),
  ref("mediarvgall0003", "The bakery front on South Congress"),
];
const MOODBOARD = ["mediarvmood0001", "mediarvmood0002", "mediarvmood0003"];

const SERVICES: readonly AssemblyService[] = [
  {
    id: "svcrvcake000001",
    sortOrder: 0,
    name: "Custom celebration cake",
    description: "Designed with you, serves 12 to 40.",
    price_display: "from",
    price_cents: 6500,
    duration_minutes: null,
    is_published: true,
  },
  {
    id: "svcrvbread00001",
    sortOrder: 1,
    name: "Weekly bread box",
    description: "Three loaves every Saturday, picked up at the shop.",
    price_display: "fixed",
    price_cents: 2400,
    duration_minutes: null,
    is_published: true,
  },
  {
    id: "svcrvclass00001",
    sortOrder: 2,
    name: "Bread class",
    description: "Learn to shape and bake a sourdough loaf.",
    price_display: "fixed",
    price_cents: 8500,
    duration_minutes: 120,
    is_published: true,
  },
];

const TEAM: readonly AssemblyTeamMember[] = [
  {
    id: "teamrvana000001",
    sortOrder: 0,
    photoId: null,
    name: "Ana Rivera",
    role: "Head baker",
    bio: "Ana has been baking sourdough for twenty years and still starts at 4 a.m.",
    is_published: true,
  },
  {
    id: "teamrvsam000001",
    sortOrder: 1,
    photoId: null,
    name: "Sam Ortiz",
    role: "Cake decorator",
    bio: "Sam designs every celebration cake with the family who orders it.",
    is_published: true,
  },
];

/** Testimonials records as validateTestimonial stores them. */
const testimonial = (quote: string, author_name: string) => ({
  quote,
  author_name,
  author_detail: "",
  rating: 5,
  photo_url: "",
  photo_alt: "",
  source: "manual",
  featured: false,
  is_published: true,
});
const TESTIMONIALS = [
  testimonial("The sourdough is the best in town.", "Jordan P."),
  testimonial(
    "Our wedding cake was perfect, and they listened to every idea.",
    "Casey L.",
  ),
  testimonial("The bread box is the highlight of my week.", "Riley M."),
];

/** seedCompleteIntake: every core field provided, Testimonials records, sent to CDS. */
export const COMPLETE_INTAKE: AssemblyIntake = {
  orgId: "orgrvbakery0001",
  path: "standard",
  fields: {
    org_name: p("Rivera Bakery"),
    path: p("standard"),
    tagline: p("Baked fresh at dawn"),
    business_type: p("bakery"),
    logo: p(LOGO.id),
    font_pairing: p("warm-classic"),
    contact_method: p({
      phone: "(512) 555-0142",
      email: "hello@riverabakery.test",
    }),
    address: p({
      street: "1200 South Congress Ave",
      city: "Austin",
      state: "TX",
      zip: "78704",
    }),
    service_area: p("Austin and Travis County"),
    time_zone: p("America/Chicago"),
    hours: p({
      mon: CLOSED,
      tue: OPEN("07:00", "15:00"),
      wed: OPEN("07:00", "15:00"),
      thu: OPEN("07:00", "15:00"),
      fri: {
        open: true,
        ranges: [
          { start: "07:00", end: "11:30" },
          { start: "13:00", end: "18:00" },
        ],
      },
      sat: OPEN("08:00", "14:00"),
      sun: CLOSED,
    }),
    socials: p([
      { platform: "instagram", url: "https://instagram.com/riverabakery" },
      { platform: "facebook", url: "https://facebook.com/riverabakery" },
    ]),
    email_delivery: p("hello@riverabakery.test"),
    about: p(
      "Rivera Bakery is a family bakery in Austin. Every loaf is shaped by hand and baked before sunrise.",
    ),
    mission: p("Good bread, made slowly, for the whole neighborhood."),
    headline: p("Bread worth getting up for"),
    services: p(SERVICES),
    team: p(TEAM),
    hero: p(HERO.id),
    gallery: p(GALLERY.map((g) => g.id)),
    moodboard: p(MOODBOARD),
    photo_descriptions: p(true),
    domain_choice: p({
      choice: "have",
      domain: "riverabakery.com",
      registrar: "hostinger",
      ideas: "",
    }),
    ga4_id: p("G-DEVSEED01"),
    gbp: p("yes"),
    legal_name: p("Rivera Bakery LLC"),
    privacy_contact: p("privacy@riverabakery.test"),
    legal_region: p("Texas"),
    addon_testimonials_records: p(TESTIMONIALS),
  },
  team: TEAM,
  services: SERVICES,
  media: { logo: LOGO, hero: HERO, gallery: GALLERY },
  addonConfig: {
    testimonials: {
      fields: {},
      records: TESTIMONIALS,
      keys: ["rvkey1", "rvkey2", "rvkey3"],
    },
  },
  selections: {
    addons: ["testimonials"],
    extras: [],
    carePlan: false,
    cadence: "monthly",
  },
  moodboardProposal: null,
};

/**
 * COMPLETE with the second gallery photo's description cleared (the seed has no empty alt),
 * for the photo-polish tests in 08-13 / 08-14 (CONTEXT A4-Q2).
 */
export const COMPLETE_WITH_UNREVIEWED_PHOTO: AssemblyIntake = {
  ...COMPLETE_INTAKE,
  media: {
    ...COMPLETE_INTAKE.media,
    gallery: COMPLETE_INTAKE.media.gallery.map((g, i) =>
      i === 1 ? { ...g, alt: "", alt_reviewed: false } : g,
    ),
  },
};

/** seedMinimalIntake: only org_name, path, time_zone and public_email; not sent. */
export const MINIMAL_INTAKE: AssemblyIntake = {
  orgId: "orgjuniper00001",
  path: "standard",
  fields: {
    org_name: p("Juniper Tutoring"),
    path: p("standard"),
    tagline: fb(null),
    business_type: fb("Juniper Tutoring"),
    logo: fb("Juniper Tutoring"),
    font_pairing: fb(null),
    contact_method: p({ phone: "", email: "juniper.tutoring@gmail.com" }),
    address: fb(null),
    service_area: fb(null),
    time_zone: p("America/Denver"),
    hours: fb("Contact us for hours"),
    socials: fb(null),
    email_delivery: p("juniper.tutoring@gmail.com"),
    about: fb(null),
    mission: fb(null),
    headline: fb(null),
    services: fb(null),
    team: fb(null),
    hero: fb(null),
    gallery: fb(null),
    moodboard: fb(null),
    photo_descriptions: p(true),
    domain_choice: fb(null),
    ga4_id: fb(null),
    gbp: fb(null),
    legal_name: fb("Juniper Tutoring"),
    privacy_contact: fb("juniper.tutoring@gmail.com"),
    legal_region: fb(null),
  },
  team: [],
  services: [],
  media: { logo: null, hero: null, gallery: [] },
  addonConfig: {},
  selections: { addons: [], extras: [], carePlan: false, cadence: "monthly" },
  moodboardProposal: null,
};
