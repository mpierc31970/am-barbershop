// Social and sharing block (owner 07-07; CONT-27, D198; no third-party SDKs).
//
// Data-bound: the social links come live from the org's public business projection
// (coreData.business.socials). The content holds options only: whether to show the links,
// whether to show share buttons, and which share targets (plain share URLs, no SDKs).
// Renderer and editor: 07-24.
// Deny by default: share list filtered to known targets, canonical order, de-duplicated.
// Pure and Edge-safe: no Node built-ins, no html cleaner, no next/* imports.
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { asRecord, isRecord, own, text } from "../validate-helpers";

export const SOCIAL_SHARE_TARGETS = Object.freeze([
  "facebook",
  "x",
  "linkedin",
  "pinterest",
  "email",
  "copy",
] as const);

export type SocialShareTarget = (typeof SOCIAL_SHARE_TARGETS)[number];

export const SOCIAL_SHARE_DEFAULT: readonly SocialShareTarget[] = Object.freeze(
  ["facebook", "x", "email", "copy"] as SocialShareTarget[],
);

export type SocialBlockContent = {
  heading: string;
  show_socials: boolean;
  show_share: boolean;
  share: SocialShareTarget[];
};

export const SOCIAL_HEADING_MAX = 120;

export function defaultSocialBlock(): SocialBlockContent {
  return {
    heading: "",
    show_socials: true,
    show_share: true,
    share: [...SOCIAL_SHARE_DEFAULT],
  };
}

function bool(raw: Record<string, unknown>, key: string): boolean {
  const v = own(raw, key);
  return typeof v === "boolean" ? v : true;
}

export function validateSocialBlock(value: unknown): SocialBlockContent {
  const raw = asRecord(value);
  const rawShare = own(raw, "share");
  let share: SocialShareTarget[];
  if (!Array.isArray(rawShare)) {
    share = [...SOCIAL_SHARE_DEFAULT];
  } else {
    const set = new Set(rawShare.filter((s) => typeof s === "string"));
    share = SOCIAL_SHARE_TARGETS.filter((t) => set.has(t));
  }
  return {
    heading: text(raw, "heading", SOCIAL_HEADING_MAX),
    show_socials: bool(raw, "show_socials"),
    show_share: bool(raw, "show_share"),
    share,
  };
}

export const socialSection: SectionTypeDefinition = {
  type: "social",
  label: "Social and sharing",
  description: "Your social links and share buttons",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultSocialBlock(),
  validate: (raw) => validateSocialBlock(raw),
  mapRichText: (content) =>
    isRecord(content)
      ? {
          ...content,
          share: Array.isArray(content.share)
            ? [...(content.share as unknown[])]
            : content.share,
        }
      : content,
  textsOf: (content) =>
    isRecord(content) &&
    typeof content.heading === "string" &&
    content.heading !== ""
      ? [content.heading]
      : [],
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => ({ popups: [], forms: [], media: [] }),
};
