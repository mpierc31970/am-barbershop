// The SEO & accessibility checklist and the live suggestions (07-30 choices 11, 12; CONT-14,
// CONT-35; D188, D235 #15, D280; 07-UI-SPEC "SEO & sharing drawer" checks table, verbatim).
//
// Suggestions, never rules: the checklist never blocks Publish (D188). Every check runs in its
// own try/catch, so a malformed block yields "fine" for that check and never a throw.
// Output order is the Search group, then the Accessibility group.
//
// Choice-11 finding (07-30): no current site renderer draws text on top of a photo (the Hero
// and Text + image blocks put text beside the image; gallery captions sit under the photo;
// slider/tabs panels are columns). TEXT_ON_IMAGE is therefore empty; a later block that
// overlays text adds its type here and the rule applies with no other change.
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import { navHasPage } from "../../content/chrome/nav";
import { htmlToPlainText } from "../../content/plain-text";
import type { NavSettings } from "../../content/chrome/nav";
import type { PageSeo } from "../../content/types";
import { contrastRatio } from "../../theme/contrast";
import {
  isRecord,
  ownString,
  ownValue,
  sectionItems,
  visibleSections,
  type SeoSection,
} from "./content-walk";
import { NOINDEX_PAGE_KINDS } from "./meta";
import { SEO_LIMITS, suggestTitle } from "./suggest";

export { SEO_LIMITS, suggestDescription, suggestTitle } from "./suggest";

export const CHECKLIST_COPY = Object.freeze({
  header: "These are suggestions. You can publish anytime.",
  groupSearch: "Search",
  groupAccessibility: "Accessibility",
  fix: "Fix",
  fineCount: (n: number) =>
    n === 1 ? "1 check looks good" : `${n} checks look good`,
  // Amber (07-UI-SPEC checks table, exact strings).
  descriptionMissing:
    "Add a description so search results say what this page is about.",
  titleLong: (n: number) =>
    `The title is ${n} characters. Search results cut it off after about ${SEO_LIMITS.title}.`,
  descriptionLong: (n: number) =>
    `The description is ${n} characters. Search results cut it off after about ${SEO_LIMITS.description}.`,
  photos: (n: number) =>
    n === 1
      ? "1 photo doesn't have a description yet."
      : `${n} photos don't have a description yet.`,
  headings: (block: string) =>
    `A Sub-heading comes before any Section heading in the "${block}" block. Use a Section heading first.`,
  vagueLink: (text: string) =>
    `A link says "${text}". Say where it goes, like "See our prices".`,
  contrast:
    "Some text on this page may be hard to read against your theme colours.",
  textOnImage: (block: string) =>
    `The text on your ${block} photo may be hard to read. Choose a darker or simpler photo, or turn off the photo.`,
  autoplay:
    "A video plays by itself. Some visitors find that distracting; consider turning off Autoplay.",
  countUp:
    "Your Stats block counts up as it appears. It's skipped for visitors who turn off animations, so this is fine to keep.",
  notInMenu:
    "This page isn't in your menu. Visitors can only reach it by a link.",
  // Fine rows (07-30 choice 12).
  fineDescription: "Has a description",
  fineTitle: "Title fits in search results",
  fineDescriptionLength: "Description fits in search results",
  finePhotos: "Every photo has a description",
  fineHeadings: "Headings are in order",
  fineLinks: "Links say where they go",
  fineContrast: "Text is easy to read",
  fineAutoplay: "No video plays by itself",
  fineCountUp: "No counting animations",
  fineMenu: "In your site menu",
});

/** Link texts that do not say where they go (lower case, trailing punctuation dropped). */
export const VAGUE_LINK_TEXT: readonly string[] = Object.freeze([
  "click here",
  "here",
  "read more",
  "more",
  "learn more",
  "this link",
  "link",
  "click",
  "go",
]);

/** A block type that draws text on top of its photo: where the photo and scrim live. */
export type TextOnImageRule = { image: string; scrim?: string };

/** Choice 11: empty today (see the header); add a type when its renderer overlays text. */
export const TEXT_ON_IMAGE: Readonly<Record<string, TextOnImageRule>> =
  Object.freeze({});

export type FixTarget =
  | { kind: "field"; field: "title" | "description" }
  | { kind: "block"; sectionId: string; itemId?: string }
  | { kind: "href"; href: string };

export type ChecklistItem = {
  id: string;
  group: "search" | "accessibility";
  status: "fine" | "check";
  text: string;
  fix?: FixTarget;
};

export type ChecklistDraft = {
  pageId: string;
  isHome: boolean;
  pageKind: string;
  title: string;
  seo: PageSeo;
  sections: readonly SeoSection[];
};

export type ChecklistTheme = {
  text: string;
  textMuted: string;
  surface: string;
  surfaceRaised: string;
  primary: string;
  onPrimary: string;
};

export type ChecklistSite = {
  businessName: string;
  nav: unknown;
  theme: ChecklistTheme | null;
  /** Library asset ids whose description is still missing. */
  mediaNeedsDescription: ReadonlySet<string>;
  blockLabel(type: string): string;
};

export type ChecklistOptions = {
  /** Test seam; defaults to TEXT_ON_IMAGE. */
  textOnImage?: Readonly<Record<string, TextOnImageRule>>;
};

export const NAV_FIX_HREF = "/hub/website?tab=navigation";

const AA = 4.5;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

type Check = (
  draft: ChecklistDraft,
  site: ChecklistSite,
  sections: SeoSection[],
  opts: ChecklistOptions,
) => ChecklistItem | null;

function fine(
  id: string,
  group: ChecklistItem["group"],
  text: string,
): ChecklistItem {
  return { id, group, status: "fine", text };
}

function amber(
  id: string,
  group: ChecklistItem["group"],
  text: string,
  fix?: FixTarget,
): ChecklistItem {
  return fix
    ? { id, group, status: "check", text, fix }
    : { id, group, status: "check", text };
}

const checkDescription: Check = (draft) =>
  str(draft.seo?.meta_description).trim() === ""
    ? amber("description", "search", CHECKLIST_COPY.descriptionMissing, {
        kind: "field",
        field: "description",
      })
    : fine("description", "search", CHECKLIST_COPY.fineDescription);

const checkTitle: Check = (draft, site) => {
  const typed = str(draft.seo?.meta_title).trim();
  const title =
    typed ||
    suggestTitle(draft.title, site.businessName, { isHome: draft.isHome });
  return title.length > SEO_LIMITS.title
    ? amber("title-length", "search", CHECKLIST_COPY.titleLong(title.length), {
        kind: "field",
        field: "title",
      })
    : fine("title-length", "search", CHECKLIST_COPY.fineTitle);
};

const checkDescriptionLength: Check = (draft) => {
  const d = str(draft.seo?.meta_description).trim();
  return d.length > SEO_LIMITS.description
    ? amber(
        "description-length",
        "search",
        CHECKLIST_COPY.descriptionLong(d.length),
        { kind: "field", field: "description" },
      )
    : fine(
        "description-length",
        "search",
        CHECKLIST_COPY.fineDescriptionLength,
      );
};

const checkMenu: Check = (draft, site) => {
  if (draft.isHome || NOINDEX_PAGE_KINDS.includes(draft.pageKind)) return null;
  const nav = isRecord(site.nav) ? (site.nav as NavSettings) : null;
  return navHasPage(nav, draft.pageId)
    ? fine("in-menu", "search", CHECKLIST_COPY.fineMenu)
    : amber("in-menu", "search", CHECKLIST_COPY.notInMenu, {
        kind: "href",
        href: NAV_FIX_HREF,
      });
};

function listOf(value: unknown, key: string): Record<string, unknown>[] {
  const v = ownValue(value, key);
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

const checkPhotos: Check = (_d, site, sections) => {
  const needs = site.mediaNeedsDescription;
  let count = 0;
  let first: FixTarget | undefined;
  const hit = (sectionId: string, itemId?: string) => {
    count += 1;
    if (!first) {
      first = itemId
        ? { kind: "block", sectionId, itemId }
        : { kind: "block", sectionId };
    }
  };
  for (const s of sections) {
    try {
      for (const item of sectionItems(s)) {
        if (item.kind !== "image") continue;
        const asset = str(item.asset);
        if (
          asset !== ""
            ? needs.has(asset)
            : str(item.url) !== "" && str(item.alt).trim() === ""
        ) {
          hit(s.id, item.id);
        }
      }
      if (s.section_type === "gallery") {
        for (const img of listOf(s.content, "images")) {
          if (img.alt_reviewed === false || needs.has(str(img.asset))) {
            hit(s.id);
          }
        }
      }
      if (s.section_type === "logo-strip") {
        for (const logo of listOf(s.content, "logos")) {
          if (needs.has(str(logo.asset))) hit(s.id);
        }
      }
    } catch {
      // A malformed block is "fine" for this check.
    }
  }
  return count > 0
    ? amber("photos", "accessibility", CHECKLIST_COPY.photos(count), first)
    : fine("photos", "accessibility", CHECKLIST_COPY.finePhotos);
};

const checkHeadings: Check = (_d, site, sections) => {
  for (const s of sections) {
    try {
      if (ownString(s.content, "heading").trim() !== "") continue;
      let sawH2 = false;
      for (const item of sectionItems(s)) {
        if (item.kind !== "heading") continue;
        if (item.level === 2) sawH2 = true;
        else if (item.level === 3 && !sawH2) {
          return amber(
            "headings",
            "accessibility",
            CHECKLIST_COPY.headings(site.blockLabel(s.section_type)),
            { kind: "block", sectionId: s.id, itemId: item.id },
          );
        }
      }
    } catch {
      // fine for this block
    }
  }
  return fine("headings", "accessibility", CHECKLIST_COPY.fineHeadings);
};

function normLink(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?:…»›>-]+$/u, "")
    .trim();
}

function isVague(text: string): boolean {
  return VAGUE_LINK_TEXT.includes(normLink(text));
}

const ANCHOR = /<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi;

function anchorTexts(html: string): string[] {
  const out: string[] = [];
  for (const m of str(html).matchAll(ANCHOR)) {
    out.push(htmlToPlainText(m[1] ?? ""));
  }
  return out;
}

const BLOCK_LINK_TEXTS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    hero: ["cta_primary_text", "cta_secondary_text"],
    "text-image": ["cta_text"],
    "cta-banner": ["button_text"],
  });

const BLOCK_RICH_TEXTS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "text-only": ["text"],
    "text-image": ["text"],
  });

const checkLinks: Check = (_d, _site, sections) => {
  const found = (text: string, sectionId: string, itemId?: string) =>
    amber(
      "links",
      "accessibility",
      CHECKLIST_COPY.vagueLink(text.trim()),
      itemId
        ? { kind: "block", sectionId, itemId }
        : { kind: "block", sectionId },
    );
  for (const s of sections) {
    try {
      for (const key of BLOCK_LINK_TEXTS[s.section_type] ?? []) {
        const t = ownString(s.content, key);
        if (isVague(t)) return found(t, s.id);
      }
      for (const key of BLOCK_RICH_TEXTS[s.section_type] ?? []) {
        for (const t of anchorTexts(ownString(s.content, key))) {
          if (isVague(t)) return found(t, s.id);
        }
      }
      for (const item of sectionItems(s)) {
        if (item.kind === "button" && isVague(str(item.text))) {
          return found(str(item.text), s.id, item.id);
        }
        if (item.kind === "text") {
          for (const t of anchorTexts(str(item.html))) {
            if (isVague(t)) return found(t, s.id, item.id);
          }
        }
      }
    } catch {
      // fine for this block
    }
  }
  return fine("links", "accessibility", CHECKLIST_COPY.fineLinks);
};

function lowContrast(fg: string, bg: string): boolean {
  try {
    return contrastRatio(fg, bg) < AA;
  } catch {
    return false;
  }
}

function hasButton(s: SeoSection): boolean {
  for (const key of BLOCK_LINK_TEXTS[s.section_type] ?? []) {
    if (ownString(s.content, key).trim() !== "") return true;
  }
  return sectionItems(s).some((i) => i.kind === "button");
}

const checkContrast: Check = (_d, site, sections, opts) => {
  const rules = opts.textOnImage ?? TEXT_ON_IMAGE;
  for (const s of sections) {
    try {
      const rule = Object.hasOwn(rules, s.section_type)
        ? rules[s.section_type]
        : undefined;
      if (
        rule &&
        ownString(s.content, rule.image) !== "" &&
        !(rule.scrim && ownValue(s.content, rule.scrim) === true)
      ) {
        return amber(
          "contrast",
          "accessibility",
          CHECKLIST_COPY.textOnImage(site.blockLabel(s.section_type)),
          { kind: "block", sectionId: s.id },
        );
      }
    } catch {
      // fine for this block
    }
  }
  const t = site.theme;
  if (t) {
    for (const s of sections) {
      try {
        const variant = ownValue(s.settings, "background_variant");
        const bg = variant === "alternate" ? t.surfaceRaised : t.surface;
        if (
          lowContrast(t.text, bg) ||
          lowContrast(t.textMuted, bg) ||
          (hasButton(s) && lowContrast(t.onPrimary, t.primary))
        ) {
          return amber("contrast", "accessibility", CHECKLIST_COPY.contrast, {
            kind: "block",
            sectionId: s.id,
          });
        }
      } catch {
        // fine for this block
      }
    }
  }
  return fine("contrast", "accessibility", CHECKLIST_COPY.fineContrast);
};

const checkAutoplay: Check = (_d, _site, sections) => {
  for (const s of sections) {
    try {
      for (const item of sectionItems(s)) {
        if (
          item.kind === "video" &&
          item.autoplay === true &&
          item.source === "media"
        ) {
          return amber("autoplay", "accessibility", CHECKLIST_COPY.autoplay, {
            kind: "block",
            sectionId: s.id,
            itemId: item.id,
          });
        }
      }
    } catch {
      // fine for this block
    }
  }
  return fine("autoplay", "accessibility", CHECKLIST_COPY.fineAutoplay);
};

const checkCountUp: Check = (_d, _site, sections) => {
  for (const s of sections) {
    if (
      s.section_type === "stats" &&
      ownValue(s.content, "count_up") === true
    ) {
      return amber("count-up", "accessibility", CHECKLIST_COPY.countUp, {
        kind: "block",
        sectionId: s.id,
      });
    }
  }
  return fine("count-up", "accessibility", CHECKLIST_COPY.fineCountUp);
};

const CHECKS: readonly [string, ChecklistItem["group"], Check][] = [
  ["description", "search", checkDescription],
  ["title-length", "search", checkTitle],
  ["description-length", "search", checkDescriptionLength],
  ["in-menu", "search", checkMenu],
  ["photos", "accessibility", checkPhotos],
  ["headings", "accessibility", checkHeadings],
  ["links", "accessibility", checkLinks],
  ["contrast", "accessibility", checkContrast],
  ["autoplay", "accessibility", checkAutoplay],
  ["count-up", "accessibility", checkCountUp],
];

const FINE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  description: CHECKLIST_COPY.fineDescription,
  "title-length": CHECKLIST_COPY.fineTitle,
  "description-length": CHECKLIST_COPY.fineDescriptionLength,
  "in-menu": CHECKLIST_COPY.fineMenu,
  photos: CHECKLIST_COPY.finePhotos,
  headings: CHECKLIST_COPY.fineHeadings,
  links: CHECKLIST_COPY.fineLinks,
  contrast: CHECKLIST_COPY.fineContrast,
  autoplay: CHECKLIST_COPY.fineAutoplay,
  "count-up": CHECKLIST_COPY.fineCountUp,
});

/** Every check, Search group first. Never throws. */
export function pageChecklist(
  draft: ChecklistDraft,
  site: ChecklistSite,
  opts: ChecklistOptions = {},
): ChecklistItem[] {
  const sections = visibleSections(draft?.sections);
  const out: ChecklistItem[] = [];
  for (const [id, group, check] of CHECKS) {
    try {
      const item = check(draft, site, sections, opts);
      if (item) out.push(item);
    } catch {
      if (id === "in-menu") continue;
      out.push(fine(id, group, FINE_TEXT[id] ?? ""));
    }
  }
  return out;
}

/** Amber items only (the builder header badge: "3 to check"). */
export function checklistCount(items: readonly ChecklistItem[]): number {
  return items.filter((i) => i.status === "check").length;
}
