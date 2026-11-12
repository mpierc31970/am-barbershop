// Add-on manifest constants (ADDON-01, D176-D178, D311). Pure and Edge-safe.

/** Product paths an add-on can be offered on (D176-D178). */
export const ADDON_PATHS = ["standard", "studio", "shop"] as const;
export type AddonPath = (typeof ADDON_PATHS)[number];

/**
 * Owner-hub items an add-on tab may place itself under (DCR admin pattern, D311). Marketing
 * since 11-08 (DASH-26).
 */
export const NAV_TARGETS = ["website", "marketing"] as const;
export type NavTarget = (typeof NAV_TARGETS)[number];

/**
 * Icon keys the hub nav can render (mapped to lucide icons in the UI). ListChecks and
 * Settings are the core Set up your site and Settings items (06-18, D311, D312); Inbox and
 * Megaphone are the core Inbox and Marketing items (07-03, D311, D-UI-P7-1). House,
 * ChartColumn, CircleHelp, LifeBuoy and Bell are the core Today, Reports, Help, CDS Support
 * and alerts icons (11-14, 11-16; D311, 11-UI-SPEC "Hub shell").
 */
export const NAV_ICON_KEYS = [
  "Globe",
  "PackagePlus",
  "MessageSquareQuote",
  "BadgeCheck",
  "ListChecks",
  "Settings",
  "Inbox",
  "Megaphone",
  "House",
  "ChartColumn",
  "CircleHelp",
  "LifeBuoy",
  "Bell",
  "CalendarClock",
  "Smartphone",
] as const;
export type NavIconKey = (typeof NAV_ICON_KEYS)[number];

export const ADDON_SLUG_RE = /^[a-z][a-z0-9-]{1,39}$/;

/** Slugs that collide with platform routes or namespaces. */
export const RESERVED_ADDON_SLUGS = [
  "core",
  "addons",
  "website",
  "hub",
  // 07-03: hub segments and core Website tab ids an add-on tab or sidebar route would
  // collide with (composeWebsiteTabs dedupes by id, so a same-slug add-on would silently
  // vanish). "media" also covers the existing /hub/media/[id]/[variant] intake thumbnails.
  "inbox",
  "marketing",
  "media",
  "forms",
  "navigation",
  "footer",
  "site",
  // WR-B03: the core entitlement keys (CORE_ENTITLEMENTS in payments/entitlements.ts; a test
  // keeps them reserved). An add-on with one of these slugs would read as a paid Care Plan.
  "care-plan",
  "media-pack",
] as const;

/**
 * Privacy clause ids the core tenant privacy policy uses (CORE_PRIVACY_CLAUSES in
 * legal/site-policy.ts; a test keeps the two equal). An add-on clause may not reuse one, or
 * its clauses would be dropped from the live /privacy page (WR-B06, D217).
 */
export const CORE_PRIVACY_CLAUSE_IDS = [
  "contact-forms",
  "contacts-newsletter",
  "analytics",
  "embedded-media",
  "cookies",
] as const;
