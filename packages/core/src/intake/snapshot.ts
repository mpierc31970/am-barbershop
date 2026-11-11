// The intake snapshot (ONB-01, ONB-02): the one read model the chokepoint fills from the
// intake, business profile, media, email routes and counts. Every still-needed rule reads it.
import type { AddonPath } from "../addons/constants";
import type { QuoteSelections } from "../pricing/types";
import type { Day, StageSlug } from "./stages";

/** "HH:MM", 15-minute steps, 00:00..23:45. */
export type TimeRange = { start: string; end: string };
export type WeeklyHours = Record<Day, { open: boolean; ranges: TimeRange[] }>;

export type Address = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "linkedin",
  "x",
  "pinterest",
  // 11-35 (Pitfall 3): the D198 presets added in P11. Rows of social_accounts project to
  // these keys; a custom account projects to "other" with its name as `label`.
  "threads",
  "yelp",
  "nextdoor",
  "other",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
/** `label` names an "other" link (a custom social account); presets never carry one. */
export type SocialLink = {
  platform: SocialPlatform;
  url: string;
  label?: string;
};

export type BusinessProfileValues = {
  tagline: string;
  business_type: string;
  business_type_other: string;
  description: string;
  phone: string;
  public_email: string;
  address: Address;
  service_area: string;
  time_zone: string;
  hours: WeeklyHours | null;
  socials: SocialLink[];
  about: string;
  mission: string;
  headline: string;
  font_pairing: string;
  ga4_id: string;
  legal_name: string;
  privacy_contact: string;
  legal_region: string;
};

export type DomainChoice = "have" | "need" | "later";
export type GbpAnswer = "yes" | "no" | "not_sure" | "";

export type IntakeAnswers = {
  domain_choice: DomainChoice;
  domain: string;
  registrar: string;
  domain_ideas: string;
  gbp: GbpAnswer;
};

export type IntakeSnapshot = {
  orgName: string;
  path: AddonPath | "";
  profile: BusinessProfileValues;
  answers: IntakeAnswers;
  counts: {
    services: number;
    team: number;
    gallery: number;
    moodboard: number;
  };
  media: { logo: boolean; hero: boolean; photosMissingAlt: number };
  email: { defaultConfirmed: boolean; bouncing: number };
  addonIntake: Record<
    string,
    { records: number; fields: Record<string, unknown> }
  >;
  selections: QuoteSelections;
  stagesSaved: StageSlug[];
};

/** The owner-facing business profile (BILL-05, 10-18): typed here so client components need not import @cds/db. */
export type BusinessProfile = BusinessProfileValues & {
  /** "" when the org has no row yet. */
  id: string;
  orgName: string;
};
