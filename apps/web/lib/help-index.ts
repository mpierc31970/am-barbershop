// Help index (11-46; DASH-17, DASH-28, D285, D110; RESEARCH Pattern 14; 11-UI-SPEC "Help").
// Who may read which help article, built per person on the server:
//   - every core training entry (CORE_TRAINING, P11 and P12 modules included) except
//     HELP_HIDDEN (12-33: P12 adds the CDS Support articles, incl. "What support includes"
//     (SUPPORT-01), readable by every role),
//     13-50: P13 adds Rate a resolved ticket and Content notices and suspension (all roles);
//     14-46: P14 adds the domain, DNS, email, review, preview-link and leaving articles
//     (p14/domains.ts audience lists; "email-address" moved there from HELP_EXTRAS);
//     staff how-tos never get an entry,
//   - HELP_EXTRAS: owner-facing how-tos with no training entry (billing, Care Plan, Stripe…),
//   - the training of the org's ACTIVE add-ons only, and only when the person may read that
//     add-on (`can(ctx, "addon:<slug>", "read")`), so a removed add-on's article disappears.
// Then filtered by audience against the person's role (T-11-46-01): billing and buying
// articles reach Owners only, people and payments Owners and Admins. Staff how-tos have no
// entry here, so they never reach a tenant (T-11-45-01). Articles come from the codegen'd
// `@cds/addon-registry/help` (no docs/ at runtime). The "Getting set up" group is listed only
// before launch; its articles still open by id after launch.
//
// Help ids: screens pass a training id ("today", "profile") or `<section>.<tab>`
// ("website.pages", "settings.people"); resolveHelpId maps the second kind (HELP_ALIASES,
// add-on tabs to the add-on's first training entry). Server-only (reads the baked articles).
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { helpArticle } from "@cds/addon-registry/help";
import { can, type AuthSubject } from "@cds/core";
import { isHubHref } from "@cds/core/today";
import type { AddonRegistry } from "@cds/core/addons";
import {
  CORE_TRAINING,
  P11_TRAINING_MODULES,
  P12_TRAINING_MODULES,
  P13_TRAINING_MODULES,
  P14_TRAINING_MODULES,
  type TrainingEntry,
} from "@cds/core/training";

export type HelpAudience = "all" | "owner" | "owner-admin";
export type HelpGroup = "addons" | "site" | "setup";

export type HelpEntry = {
  id: string;
  title: string;
  /** One line from the how-to, plain text. */
  summary: string;
  /** Always /hub/help/<id>. */
  href: string;
  audience: HelpAudience;
  group: HelpGroup;
  /** docs/how-to/<file>.md */
  howTo: string;
};

export const HELP_GROUP_LABEL: Readonly<Record<HelpGroup, string>> =
  Object.freeze({
    addons: "Your add-ons",
    site: "Your site",
    setup: "Getting set up",
  });

/**
 * Audience map (11-46 choice 2). Ids not listed are "all". The P11 modules' own `ownerOnly`
 * and `ownerAdminOnly` lists (p11/pages.ts add-pages; p11/growth.ts download-data,
 * people-roles) are merged in below, so a module that adds one is honoured without an edit
 * here.
 */
export const HELP_AUDIENCE: Readonly<Record<string, HelpAudience>> =
  Object.freeze({
    // Buying, billing, signing and paying: Owner only (billing:read, purchases:run, legal_ack).
    billing: "owner",
    "care-plan": "owner",
    "media-storage": "owner",
    "add-ons-after-launch": "owner",
    quotes: "owner",
    "reaccept-terms": "owner",
    // Owner manages, Admin reads (members:read, connect:read, agreements:read, addons:read).
    payments: "owner-admin",
    "get-add-ons": "owner-admin",
    "legal-copy": "owner-admin",
    "policy-pages": "owner-admin",
    "email-address": "owner-admin",
    agreement: "owner-admin",
    checkout: "owner-admin",
    // SUPPORT-01 (12-33): support is included in every plan, so every role reads it.
    "what-support-includes": "all",
  });

/**
 * Entries kept out of Help: CDS staff features with no tenant screen, and (A&M fork: payment
 * is in store only) the Stripe, CDS billing and buying how-tos.
 */
export const HELP_HIDDEN: ReadonlySet<string> = new Set([
  "theming",
  "payments",
  "billing",
  "checkout",
  "quotes",
  "care-plan",
  "media-storage",
]);

type HelpExtra = {
  id: string;
  title: string;
  howTo: string;
  group: HelpGroup;
};

/** Owner-facing how-tos with no training entry; ids never collide with training ids. */
export const HELP_EXTRAS: readonly HelpExtra[] = Object.freeze([
  {
    id: "billing",
    title: "Billing and invoices",
    howTo: "docs/how-to/billing-and-invoices.md",
    group: "site",
  },
  {
    id: "care-plan",
    title: "Care Plan",
    howTo: "docs/how-to/care-plan.md",
    group: "site",
  },
  {
    id: "media-storage",
    title: "Media storage packs",
    howTo: "docs/how-to/media-storage-packs.md",
    group: "site",
  },
  {
    id: "get-add-ons",
    title: "Get add-ons",
    howTo: "docs/how-to/addons-get-add-ons.md",
    group: "site",
  },
  {
    id: "add-ons-after-launch",
    title: "Add an add-on after launch",
    howTo: "docs/how-to/add-an-addon-after-launch.md",
    group: "site",
  },
  {
    id: "quotes",
    title: "Accept a quote from Support",
    howTo: "docs/how-to/accept-a-quote.md",
    group: "site",
  },
  {
    id: "payments",
    title: "Connect your Stripe account",
    howTo: "docs/how-to/connect-stripe.md",
    group: "site",
  },
  {
    id: "legal-copy",
    title: "Download your signed agreement",
    howTo: "docs/how-to/download-signed-copy.md",
    group: "site",
  },
  {
    id: "policy-pages",
    title: "Publish your site's policy pages",
    howTo: "docs/how-to/site-policy-pages.md",
    group: "site",
  },
  {
    id: "reaccept-terms",
    title: "Accept updated terms",
    howTo: "docs/how-to/reaccept-terms.md",
    group: "site",
  },
  {
    // Today's "You're live" step 2 links here (YOURE_LIVE_HREFS.googleHelp).
    id: "google-business-profile",
    title: "Check your Google Business Profile",
    howTo: "docs/how-to/google-business-profile.md",
    group: "site",
  },
  {
    // 11-50: the Business info tab's own article (was aliased to "setup").
    id: "business-info",
    title: "Keep your business info up to date",
    howTo: "docs/how-to/business-info.md",
    group: "site",
  },
  {
    // 11-50: Builder Pro's form features (Website › Forms).
    id: "forms-pro",
    title: "Forms Pro",
    howTo: "docs/how-to/forms-pro.md",
    group: "site",
  },
  {
    // 11-50: the public policy pages, readable without signing in.
    id: "cds-policies",
    title: "Read the policies",
    howTo: "docs/how-to/read-cds-policies.md",
    group: "site",
  },
  {
    id: "csv-import",
    title: "CSV import and backups",
    howTo: "docs/how-to/csv-import.md",
    group: "site",
  },
  {
    id: "agreement",
    title: "Sign your agreement",
    howTo: "docs/how-to/sign-your-agreement.md",
    group: "setup",
  },
  {
    id: "checkout",
    title: "Checkout",
    howTo: "docs/how-to/checkout.md",
    group: "setup",
  },
]);

/** Core training ids listed under "Getting set up" (before launch only). */
export const SETUP_IDS: ReadonlySet<string> = new Set([
  "setup",
  "mood-board",
  "site-assembly",
  "agreement",
  "checkout",
]);

/** Screen help ids (`<section>.<tab>`, section ids, the bell) to article ids. */
export const HELP_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  bell: "needs-you",
  "inbox.messages": "inbox",
  "inbox.filtered": "inbox",
  website: "pages",
  "website.pages": "pages",
  "website.services": "services-list",
  "website.media": "media-library",
  "website.forms": "forms",
  "website.navigation": "site-navigation",
  "website.footer": "site-footer",
  "website.banner": "banner",
  "website.popups": "popups",
  "website.site": "site-settings",
  marketing: "contacts",
  "marketing.contacts": "contacts",
  "marketing.social": "social-accounts",
  reports: "site-report",
  "reports.site": "site-report",
  "reports.social": "site-report",
  settings: "business-info",
  "settings.business": "business-info",
  "settings.team-hours": "team-hours",
  "settings.email": "email-routing",
  "settings.people": "people-roles",
  "settings.legal": "legal-copy",
  "add-ons": "get-add-ons",
  // 12-33: CDS Support. The tabs carry their own P12 ids (sections.ts); this covers the
  // generic `support.<tab>` form for the Tickets tab (the section itself is `support`).
  "support.tickets": "support.follow-ticket",
  // 14-46: P14 screens (sections.ts settingsTabHelpId flips Domain and Integrations to these).
  "settings.domain": "connect-your-domain",
  "settings.integrations": "connect-your-domain",
  review: "review-your-site-before-launch",
});

/**
 * Core training ids, so a dotted training id (P12 `support.messages`, `support.follow-ticket`)
 * resolves to itself instead of being read as `<section>.<add-on slug>` (12-33).
 */
const CORE_TRAINING_IDS: ReadonlySet<string> = new Set(
  CORE_TRAINING.map((t) => t.id),
);

type AudienceLists = { ownerOnly?: unknown; ownerAdminOnly?: unknown };

function stringList(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

/**
 * HELP_AUDIENCE plus the P11-P14 modules' ownerOnly / ownerAdminOnly exports, so a later
 * audience list in a P12 module is honoured, never silently ignored (review IN-B03).
 */
function audienceMap(): Readonly<Record<string, HelpAudience>> {
  const out: Record<string, HelpAudience> = { ...HELP_AUDIENCE };
  for (const m of [
    ...P11_TRAINING_MODULES,
    ...P12_TRAINING_MODULES,
    ...P13_TRAINING_MODULES,
    ...P14_TRAINING_MODULES,
  ] as readonly AudienceLists[]) {
    for (const id of stringList(m.ownerAdminOnly)) out[id] = "owner-admin";
    for (const id of stringList(m.ownerOnly)) out[id] = "owner";
  }
  return out;
}

const AUDIENCE = audienceMap();

export function helpAudience(id: string): HelpAudience {
  return Object.prototype.hasOwnProperty.call(AUDIENCE, id)
    ? AUDIENCE[id]!
    : "all";
}

/** True when the person's role may read an article for `audience`. */
export function audienceAllows(
  subject: AuthSubject,
  audience: HelpAudience,
): boolean {
  if (audience === "owner") return subject.role === "owner";
  if (audience === "owner-admin")
    return subject.role === "owner" || subject.role === "admin";
  return true;
}

export function helpHref(id: string): string {
  return `/hub/help/${encodeURIComponent(id)}`;
}

function entryFor(
  e: { id: string; title: string; howTo: string },
  group: HelpGroup,
): HelpEntry | null {
  const article = helpArticle(e.howTo);
  if (!article) return null;
  return {
    id: e.id,
    title: e.title,
    summary: article.summary,
    href: helpHref(e.id),
    audience: helpAudience(e.id),
    group,
    howTo: e.howTo,
  };
}

export type HelpIndexOptions = {
  /** List "Getting set up" (true before launch). Default true. */
  includeSetup?: boolean;
  registry?: AddonRegistry;
};

function byTitle(a: HelpEntry, b: HelpEntry): number {
  return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
}

/**
 * The help articles this person may read, grouped and sorted: add-ons (alphabetical), the
 * site (alphabetical), then setup (in setup order). Never throws.
 */
export function buildHelpIndex(
  ctx: AuthSubject,
  active: readonly string[],
  options: HelpIndexOptions = {},
): HelpEntry[] {
  const registry = options.registry ?? ADDON_REGISTRY;
  const includeSetup = options.includeSetup ?? true;
  const seen = new Set<string>();
  const addons: HelpEntry[] = [];
  const site: HelpEntry[] = [];
  const setup: HelpEntry[] = [];
  const push = (entry: HelpEntry | null) => {
    if (!entry || seen.has(entry.id)) return;
    if (!audienceAllows(ctx, entry.audience)) return;
    seen.add(entry.id);
    if (entry.group === "addons") addons.push(entry);
    else if (entry.group === "setup") setup.push(entry);
    else site.push(entry);
  };

  const on = new Set(active);
  // A&M fork: a barber seat (renter, staff) gets only the profile help (Studio Booking).
  const seatOnly = ctx.role === "renter" || ctx.role === "staff";
  for (const m of registry.list()) {
    if (!on.has(m.slug) || !can(ctx, `addon:${m.slug}`, "read")) continue;
    if (seatOnly && m.slug !== "studio-booking") continue;
    for (const t of m.training) push(entryFor(t, "addons"));
  }
  if (seatOnly) return addons.sort(byTitle);
  const core: readonly { id: string; title: string; howTo: string }[] = [
    ...CORE_TRAINING.filter((t: TrainingEntry) => !HELP_HIDDEN.has(t.id)),
    ...HELP_EXTRAS.filter((e) => !HELP_HIDDEN.has(e.id)),
  ];
  for (const e of core) {
    push(entryFor(e, SETUP_IDS.has(e.id) ? "setup" : "site"));
  }

  const setupOrder = [...SETUP_IDS];
  setup.sort((a, b) => setupOrder.indexOf(a.id) - setupOrder.indexOf(b.id));
  return [
    ...addons.sort(byTitle),
    ...site.sort(byTitle),
    ...(includeSetup ? setup : []),
  ];
}

/**
 * The article id a screen's help id points at: itself when it is an article id, an alias, or
 * `<section>.<add-on slug>` → that add-on's first training entry. null when unknown.
 */
export function resolveHelpId(
  id: string,
  registry: AddonRegistry = ADDON_REGISTRY,
): string | null {
  if (typeof id !== "string" || id.length === 0 || id.length > 200) return null;
  if (Object.prototype.hasOwnProperty.call(HELP_ALIASES, id)) {
    return HELP_ALIASES[id]!;
  }
  if (CORE_TRAINING_IDS.has(id)) return id;
  const dot = id.indexOf(".");
  if (dot > 0) {
    const slug = id.slice(dot + 1);
    const manifest = registry.list().find((m) => m.slug === slug);
    return manifest?.training[0]?.id ?? null;
  }
  return id;
}

/** The entry a help id opens for this person (null → 404: unknown or not permitted). */
export function findHelpEntry(
  ctx: AuthSubject,
  active: readonly string[],
  rawId: string,
  registry: AddonRegistry = ADDON_REGISTRY,
): HelpEntry | null {
  const id = resolveHelpId(rawId, registry);
  if (!id) return null;
  return (
    buildHelpIndex(ctx, active, { registry, includeSetup: true }).find(
      (e) => e.id === id,
    ) ?? null
  );
}

/** Help entries for Jump to (DASH-28): the same grant-filtered list, id/title/href only. */
export function jumpHelpEntries(
  index: readonly HelpEntry[],
): { id: string; title: string; href: string }[] {
  return index.map((h) => ({ id: h.id, title: h.title, href: h.href }));
}

function plain(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .toLowerCase();
}

/** Lower-case text the Help center search matches: summary plus every step. */
export function helpSearchText(entry: HelpEntry): string {
  const a = helpArticle(entry.howTo);
  if (!a) return entry.summary.toLowerCase();
  const steps = [...a.activate, ...a.use].flatMap((s) => [
    s.screen,
    s.action,
    s.expected,
  ]);
  return plain([entry.summary, ...steps].join(" ")).replace(/\s+/g, " ");
}

/**
 * The hub screen a how-to's front-matter `route` names ("/hub/settings?tab=billing"), or
 * null when it is not a plain hub route (terminal tools, placeholders, the Help center).
 */
export function helpRouteHref(route: string): string | null {
  const first = route.trim().split(/\s/, 1)[0]?.replace(/`/g, "") ?? "";
  if (!isHubHref(first) || /[<>{}]/.test(first)) return null;
  if (first === "/hub/help" || first.startsWith("/hub/help/")) return null;
  return first;
}

/**
 * href for a markdown link inside an article ("profile-and-alerts.md"): the Help article of
 * that how-to when this person may read it, else null (the label stays plain text).
 */
export function helpLinkFor(
  index: readonly HelpEntry[],
): (target: string) => string | null {
  const byFile = new Map<string, string>();
  for (const e of index) {
    const file = e.howTo.slice(e.howTo.lastIndexOf("/") + 1);
    if (!byFile.has(file)) byFile.set(file, e.href);
  }
  return (target) => {
    const file = target.split("#", 1)[0]?.split("/").pop() ?? "";
    return byFile.get(file) ?? null;
  };
}
