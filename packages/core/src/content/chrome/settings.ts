// Site-level settings rules (CONT-29; CONT-15 toggle half; CONT-34 hideTranslate; D237;
// CONTEXT Area 4 row 5; 07-26 choices 1-4, 6, 8, 12). Owner 07-26; 07-29 snapshots the
// settings part; 07-30 adds SEO defaults to the same part.
//
// The logical `settings` part is four fields stored in three site_settings columns:
// `language` (text), `settings` json { show_translate, show_search } and
// `seo.allow_ai_crawlers` (merged into the existing seo json, never replacing its other
// keys). Each stored piece resolves on its own: a malformed piece falls back to its default.
//
// Translate (D237): only a link to the public translate.google.com URL. No Google script,
// frame or request ever; the visitor's click is the only contact with Google.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports.
import { InvalidInput } from "../../errors";
import { asRecord, isRecord, own } from "../validate-helpers";

export type SiteSettingsGroup = {
  /** BCP 47 tag, canonical case (normalizeLanguageTag). */
  language: string;
  show_translate: boolean;
  show_search: boolean;
  allow_ai_crawlers: boolean;
  /** 07-30 (CONT-28): library photo id of the site share image; "" = the generated one. */
  share_image: string;
};

export type SiteSettingsPatch = Partial<SiteSettingsGroup>;

export const SITE_SETTINGS_DEFAULTS: Readonly<SiteSettingsGroup> =
  Object.freeze({
    language: "en",
    show_translate: false,
    show_search: false,
    allow_ai_crawlers: true,
    share_image: "",
  });

export const SITE_LANGUAGE_MAX = 35;

/** Select list order (UI-SPEC "Site settings"); "Other…" is added by the form. */
export const SITE_LANGUAGES: readonly { code: string; label: string }[] =
  Object.freeze(
    [
      { code: "en", label: "English" },
      { code: "es", label: "Spanish" },
      { code: "fr", label: "French" },
      { code: "de", label: "German" },
      { code: "pt", label: "Portuguese" },
      { code: "it", label: "Italian" },
      { code: "vi", label: "Vietnamese" },
      { code: "zh-Hans", label: "Chinese (Simplified)" },
      { code: "ko", label: "Korean" },
      { code: "tl", label: "Tagalog" },
      { code: "ar", label: "Arabic" },
    ].map((l) => Object.freeze(l)),
  );

export const SITE_SETTINGS_COPY = Object.freeze({
  heading: "Site settings",
  liveNote: "Changes show on your site as soon as you save.",
  languageSection: "Language",
  searchAiSection: "Search engines and AI",
  cookieSection: "Cookie notice",
  searchSection: "Search",
  languageLabel: "Your site's language",
  languageHelp:
    "Tells browsers and screen readers how to read your site. The editor stays in English.",
  otherOption: "Other…",
  otherLabel: "Language code",
  otherHelp: "Use a code like pt-BR or yue.",
  invalidLanguage: "Enter a language code like pt-BR.",
  translateLabel: "Show a Translate link",
  translateHelp:
    "Visitors can open your site in Google Translate. Nothing from Google loads until they click.",
  aiLabel: "Let AI assistants read your site",
  aiHelp:
    "Tools like ChatGPT and Claude can use your pages to answer questions about your business. Turn off to ask them not to.",
  sitemap: (host: string) => `Your sitemap: ${host}/sitemap.xml`,
  searchLabel: "Show a search button in the menu",
  translateLink: "Translate",
  newTab: "(opens in a new tab)",
  consentUnknown: "We couldn't check this right now. Try again in a minute.",
  saved: "Settings saved. It's live on your site.",
  save: "Save settings",
  invalidSwitch: "This setting must be on or off.",
  shareImageInvalid: "Choose a photo from your media.",
  // 07-30 Sharing section (07-UI-SPEC "Site settings" Sharing; D-UI-P7-3).
  sharingSection: "Sharing",
  siteIconLabel: "Site icon",
  shareImageLabel: "Share image",
  madeFromLogo: "Made from your logo.",
  madeFromName: "Made from your business name until you add a logo.",
  changeLogo: "Change your logo in Settings › Business info",
  addLogo: "Add your logo in Settings › Business info",
  businessInfoHref: "/hub/settings?tab=business",
  shareImageHelp:
    "Shown when someone shares a link to your site. Pages can choose their own in SEO & sharing.",
  noAddress: "Your site icon appears once your site has an address.",
  iconOnWhite: "On a light background",
  iconOnDark: "On a dark background",
});

/** A media_assets record id (PocketBase: 15 lower-case alphanumerics). */
export const SHARE_IMAGE_ID_RE = /^[a-z0-9]{15}$/;

/** "" or a record id; anything else -> null. */
export function shareImageId(raw: unknown): string | null {
  if (raw === "") return "";
  return typeof raw === "string" && SHARE_IMAGE_ID_RE.test(raw) ? raw : null;
}

const TAG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

/** BCP 47 tag in canonical case, or null (pt-BR, zh-Hans, es-419, yue). */
export function normalizeLanguageTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.length === 0 || t.length > SITE_LANGUAGE_MAX || !TAG_RE.test(t)) {
    return null;
  }
  return t
    .split("-")
    .map((part, i) => {
      if (i === 0) return part.toLowerCase();
      if (/^[A-Za-z]{4}$/.test(part)) {
        return part[0]!.toUpperCase() + part.slice(1).toLowerCase();
      }
      if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join("-");
}

const SWITCH_KEYS = [
  "show_translate",
  "show_search",
  "allow_ai_crawlers",
] as const;

/** Deny by default: own properties only, unknown keys dropped, bad values refused. */
export function validateSiteSettingsPatch(raw: unknown): SiteSettingsPatch {
  const r = asRecord(raw);
  const out: SiteSettingsPatch = {};
  const lang = own(r, "language");
  if (lang !== undefined) {
    const tag = normalizeLanguageTag(lang);
    if (!tag) throw new InvalidInput(SITE_SETTINGS_COPY.invalidLanguage);
    out.language = tag;
  }
  for (const key of SWITCH_KEYS) {
    const v = own(r, key);
    if (v === undefined) continue;
    if (typeof v !== "boolean") {
      throw new InvalidInput(SITE_SETTINGS_COPY.invalidSwitch);
    }
    out[key] = v;
  }
  const share = own(r, "share_image");
  if (share !== undefined) {
    const id = shareImageId(share);
    if (id === null)
      throw new InvalidInput(SITE_SETTINGS_COPY.shareImageInvalid);
    out.share_image = id;
  }
  return out;
}

export function mergeSiteSettings(
  current: SiteSettingsGroup,
  patch: SiteSettingsPatch,
): SiteSettingsGroup {
  return {
    language: patch.language ?? current.language,
    show_translate: patch.show_translate ?? current.show_translate,
    show_search: patch.show_search ?? current.show_search,
    allow_ai_crawlers: patch.allow_ai_crawlers ?? current.allow_ai_crawlers,
    share_image: patch.share_image ?? current.share_image,
  };
}

function ownBool(r: unknown, key: string, fallback: boolean): boolean {
  if (!isRecord(r)) return fallback;
  const v = own(r, key);
  return typeof v === "boolean" ? v : fallback;
}

/** Stored row fields -> the group. Never throws; each piece defaults on its own. */
export function resolveSiteSettings(raw: {
  language?: unknown;
  settings?: unknown;
  seo?: unknown;
}): SiteSettingsGroup {
  const d = SITE_SETTINGS_DEFAULTS;
  return {
    language: normalizeLanguageTag(raw.language) ?? d.language,
    show_translate: ownBool(raw.settings, "show_translate", d.show_translate),
    show_search: ownBool(raw.settings, "show_search", d.show_search),
    allow_ai_crawlers: ownBool(
      raw.seo,
      "allow_ai_crawlers",
      d.allow_ai_crawlers,
    ),
    share_image: isRecord(raw.seo)
      ? (shareImageId(own(raw.seo, "share_image")) ?? d.share_image)
      : d.share_image,
  };
}

/** The group -> the three stored fields; other `seo` keys are kept (07-30: share_image). */
export function storedSiteSettings(
  group: SiteSettingsGroup,
  currentSeo: unknown,
): {
  language: string;
  settings: { show_translate: boolean; show_search: boolean };
  seo: Record<string, unknown>;
} {
  const seo: Record<string, unknown> = {};
  if (isRecord(currentSeo)) {
    for (const key of Object.keys(currentSeo)) {
      if (key === "__proto__") continue;
      seo[key] = currentSeo[key];
    }
  }
  seo.allow_ai_crawlers = group.allow_ai_crawlers;
  // 07-30: the site share image sits beside allow_ai_crawlers; "" removes the key.
  const share = shareImageId(group.share_image);
  if (share) seo.share_image = share;
  else delete seo.share_image;
  return {
    language: group.language,
    settings: {
      show_translate: group.show_translate,
      show_search: group.show_search,
    },
    seo,
  };
}

export const TRANSLATE_BASE = "https://translate.google.com/translate";

/** The Google Translate link for a page, or null when the page URL is not http(s). */
export function translateUrl(
  pageUrl: string,
  visitorLang: unknown,
): string | null {
  if (typeof pageUrl !== "string") return null;
  const u = pageUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const tl = normalizeLanguageTag(visitorLang) ?? "en";
  return `${TRANSLATE_BASE}?sl=auto&tl=${encodeURIComponent(tl)}&u=${encodeURIComponent(u)}`;
}

/** Page kinds that hide the Translate link (checkout / booking add-on kinds, P9+). */
export type PageKindFlags = Readonly<
  Record<string, Readonly<{ hideTranslate?: true }>>
>;

export const PAGE_KIND_FLAGS: PageKindFlags = Object.freeze({
  builder: Object.freeze({}),
  "system-404": Object.freeze({}),
});

export function hidesTranslateIn(flags: PageKindFlags, kind: unknown): boolean {
  if (typeof kind !== "string" || !Object.hasOwn(flags, kind)) return false;
  return flags[kind]?.hideTranslate === true;
}

export function hidesTranslate(kind: unknown): boolean {
  return hidesTranslateIn(PAGE_KIND_FLAGS, kind);
}

/** Marker on `<main>` of a page whose kind hides Translate; the island checks for it. */
export const HIDE_TRANSLATE_ATTR = "data-cds-hide-translate";
