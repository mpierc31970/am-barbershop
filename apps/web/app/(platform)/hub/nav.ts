// Hub sidebar composition (D311; 05-UI-SPEC "Hub shell changes"; 11-UI-SPEC "Hub shell";
// ADDON-09; CONTEXT A4-Q3; DASH-24, DASH-27, DASH-30). Pure: the layout computes it on the
// server from the session (role, grants), the org's active add-ons, the stage and the
// Needs-you list, and passes plain data to the client HubShell. One flat list, in the order
// D311 fixes; an item a person may not see is absent, never greyed:
//   1. "Set up your site" (`ListChecks`): business readers, only while the stage is intake,
//      fit_review or ready_for_build (11-14 Pitfall 2: from being_built Today takes over,
//      D312), with a count of required items still needed (06-18, D-UI-P6-16).
//   2. Today (`House`): every member. No badge (Today is the list).
//   3. Inbox: content readers (Owner, Admin, Editor, Viewer; 07-03).
//   4. Website: content readers, or a grant for an active add-on (a grant-only member sees
//      Website with just that add-on's tab, 05-12).
//   5. Active add-ons placed in the sidebar, in manifest order, for members who may read them.
//   6. Marketing: contacts readers (Owner, Admin, staff, renter per MATRIX; D-UI-P7-1), and
//      since 11-37 content readers too (Editor, Viewer see Marketing › Social only).
//   7. Reports (`ChartColumn`): content readers, Viewers included (D310).
//   8. Settings: business readers (Owner, Admin, Editor read-only; never Viewer, T-06-90).
// Pinned below: Get add-ons (Owner and Admin), Help and CDS Support (everyone).
// Badges (DASH-27) are counts of the person's already grant-filtered Needs-you list grouped
// by section (`groupCounts`); a section whose provider failed shows no badge (never a wrong
// one). The Inbox badge prefers the layout's true unread count (the Needs-you inbox list
// stops at 20, 11-13).
import { can, type OrgRole } from "@cds/core";
import type { AddonRegistry, NavIconKey } from "@cds/core/addons";
import { groupCounts, type NeedsYouItem } from "@cds/core/today";

/**
 * Icons for the core Today, Reports, Help and CDS Support items (11-14 choice 1). Since
 * 11-16 they are also in NAV_ICON_KEYS and the HubShell icon map.
 */
export type HubCoreIconKey =
  "House" | "ChartColumn" | "CircleHelp" | "LifeBuoy";

export type HubNavItem = {
  href: string;
  label: string;
  iconKey: NavIconKey | HubCoreIconKey;
  /** A small count (required items still needed, Needs-you items); absent when zero. */
  badge?: number;
};

export type HubNav = { items: HubNavItem[]; pinned: HubNavItem[] };

/** The layout's Needs-you result (`getNeedsYou()`, 11-13). */
export type HubNeedsYou = {
  items: readonly NeedsYouItem[];
  failed: readonly string[];
};

export const TODAY_NAV: HubNavItem = Object.freeze({
  href: "/hub/today",
  label: "Today",
  iconKey: "House",
});

/** A&M fork: the person's own alerts, acted on in place; the first screen after sign-in. */
export const ALERTS_NAV: HubNavItem = Object.freeze({
  href: "/hub/alerts",
  label: "Alerts",
  iconKey: "Bell",
});

export const WEBSITE_NAV: HubNavItem = Object.freeze({
  href: "/hub/website",
  label: "Website",
  iconKey: "Globe",
});

export const INBOX_NAV: HubNavItem = Object.freeze({
  href: "/hub/inbox",
  label: "Inbox",
  iconKey: "Inbox",
});

export const MARKETING_NAV: HubNavItem = Object.freeze({
  href: "/hub/marketing",
  label: "Marketing",
  iconKey: "Megaphone",
});

export const REPORTS_NAV: HubNavItem = Object.freeze({
  href: "/hub/reports",
  label: "Reports",
  iconKey: "ChartColumn",
});

export const GET_ADDONS: HubNavItem = Object.freeze({
  href: "/hub/add-ons",
  label: "Get add-ons",
  iconKey: "PackagePlus",
});

export const HELP_NAV: HubNavItem = Object.freeze({
  href: "/hub/help",
  label: "Help",
  iconKey: "CircleHelp",
});

export const SUPPORT_NAV: HubNavItem = Object.freeze({
  href: "/hub/support",
  label: "Support",
  iconKey: "LifeBuoy",
});

export const SETUP_NAV: HubNavItem = Object.freeze({
  href: "/hub/setup",
  label: "Set up your site",
  iconKey: "ListChecks",
});

export const SETTINGS_NAV: HubNavItem = Object.freeze({
  href: "/hub/settings",
  label: "Settings",
  iconKey: "Settings",
});

/**
 * Pre-build stages that show "Set up your site" (11-14 Pitfall 2). From being_built the
 * still-needed intake items are Needs-you rows on Today (D312 "one hub", DASH-30).
 */
export const SETUP_STAGES = [
  "intake",
  "fit_review",
  "ready_for_build",
] as const;

export function inSetup(stage: string | undefined): boolean {
  return (SETUP_STAGES as readonly string[]).includes(stage ?? "");
}

/** Hub routes a sidebar add-on's /hub/<slug> may never shadow. */
export const CORE_SEGMENTS: ReadonlySet<string> = new Set([
  "today",
  "alerts",
  "website",
  "add-ons",
  "setup",
  "settings",
  "inbox",
  "marketing",
  "media",
  "reports",
  "help",
  "profile",
  "support",
]);

/**
 * The href of an add-on's own screen: its Website (or Marketing) tab, or its sidebar route.
 * A manifest-only add-on (placement "none", 10-07) has no screen, so Manage goes to its
 * detail page.
 */
export function addonHref(m: {
  slug: string;
  nav: { placement: "tab" | "sidebar" | "none"; item?: string };
}): string {
  if (m.nav.placement === "tab") {
    const section = m.nav.item === "marketing" ? "marketing" : "website";
    return `/hub/${section}?tab=${encodeURIComponent(m.slug)}`;
  }
  if (m.nav.placement === "none") {
    return `/hub/add-ons/${encodeURIComponent(m.slug)}`;
  }
  return `/hub/${encodeURIComponent(m.slug)}`;
}

/** Needs-you provider name (11-13 `failed[]`) → the section badge it feeds. */
const PROVIDER_SECTION: Readonly<Record<string, string>> = {
  inbox: "inbox",
  billing: "settings",
  stripe: "settings",
  agreement: "settings",
  email: "settings",
  intake: "today",
};

/**
 * Every Needs-you provider that feeds a badge, plus "addons": the layout's `failed` list
 * when the whole Needs-you read throws (11-16), so every badge is omitted.
 */
export const ALL_NEEDS_YOU_FAILED: readonly string[] = Object.freeze([
  ...Object.keys(PROVIDER_SECTION),
  "addons",
]);

/**
 * True when the section's count may be incomplete: one of its providers failed. "addons"
 * (the active/paused add-on read failed) covers every `addon:<slug>` section.
 */
export function sectionFailed(
  section: string,
  failed: readonly string[],
): boolean {
  for (const f of failed) {
    if (f === section) return true;
    if (PROVIDER_SECTION[f] === section) return true;
    if (f === "addons" && section.startsWith("addon:")) return true;
  }
  return false;
}

/**
 * A badge count for a section, or undefined when it is zero or unreliable. `parts` are the
 * sections whose items add up to this one (an item's own section, plus its tab add-ons).
 */
export function sectionBadge(
  parts: readonly string[],
  needsYou: HubNeedsYou | undefined,
): number | undefined {
  if (!needsYou) return undefined;
  if (parts.some((p) => sectionFailed(p, needsYou.failed))) return undefined;
  const { bySection } = groupCounts(needsYou.items);
  const n = parts.reduce((sum, p) => sum + (bySection[p] ?? 0), 0);
  return n > 0 ? n : undefined;
}

function withBadge(item: HubNavItem, badge: number | undefined): HubNavItem {
  return badge !== undefined && Number.isFinite(badge) && badge > 0
    ? { ...item, badge: Math.floor(badge) }
    : { ...item };
}

/** Active tab-placed add-ons under one section item ("website" or "marketing"). */
export function tabAddonSlugs(
  registry: AddonRegistry,
  active: readonly string[],
  section: "website" | "marketing",
): string[] {
  const on = new Set(active);
  return registry
    .list()
    .filter(
      (m) =>
        on.has(m.slug) && m.nav.placement === "tab" && m.nav.item === section,
    )
    .map((m) => m.slug);
}

export function composeHubNav(input: {
  role: OrgRole;
  grants: readonly string[];
  active: readonly string[];
  registry: AddonRegistry;
  /** organizations.stage ("" once past onboarding). */
  stage?: string;
  /** Required intake items still missing, for the setup badge (pre-build only). */
  stillNeededCount?: number;
  /**
   * The person's Needs-you list (`getNeedsYou()`, already grant-filtered on the server).
   * Absent: no section badges (the layout switches to it in 11-16).
   */
  needsYou?: HubNeedsYou;
  /** True unread count (countSubmissions); wins over the capped Needs-you inbox list. */
  inboxUnread?: number;
}): HubNav {
  const { role, grants, registry, needsYou } = input;
  const subject = { role, grants };
  const on = new Set(input.active);
  const activeManifests = registry.list().filter((m) => on.has(m.slug));
  const readsContent = can(subject, "content", "read");
  const readsBusiness = can(subject, "business", "read");
  const readable = (slug: string) => can(subject, `addon:${slug}`, "read");
  // A&M fork: barber seats (renter, staff) see only their own setup: Today, My profile
  // (Studio Booking opens their own seat), Help. No Marketing, no CDS Support.
  const seatOnly = role === "renter" || role === "staff";

  const items: HubNavItem[] = [];
  if (inSetup(input.stage) && readsBusiness) {
    items.push(withBadge(SETUP_NAV, Math.max(0, input.stillNeededCount ?? 0)));
  }
  items.push({ ...TODAY_NAV }, { ...ALERTS_NAV });
  if (readsContent) {
    const unread = input.inboxUnread;
    const inboxFailed =
      needsYou !== undefined && sectionFailed("inbox", needsYou.failed);
    const badge = inboxFailed
      ? undefined
      : typeof unread === "number" && Number.isFinite(unread)
        ? unread
        : sectionBadge(["inbox"], needsYou);
    items.push(withBadge(INBOX_NAV, badge));
  }
  // A&M fork: a grant-only member (a barber) sees Website only when it has a tab for them; a
  // granted add-on with its own sidebar item (Studio Booking's "Barbers") never adds it.
  const websiteTabs = tabAddonSlugs(registry, input.active, "website").filter(
    readable,
  );
  if (readsContent || websiteTabs.length > 0) {
    const parts = ["website", ...websiteTabs.map((s) => `addon:${s}`)];
    items.push(withBadge(WEBSITE_NAV, sectionBadge(parts, needsYou)));
  }
  for (const m of activeManifests) {
    // Only sidebar add-ons: tabs live under Website/Marketing, "none" (10-07) has no screen.
    if (m.nav.placement !== "sidebar") continue;
    if (CORE_SEGMENTS.has(m.slug)) continue;
    if (!readable(m.slug)) continue;
    items.push(
      withBadge(
        {
          href: addonHref(m),
          label:
            seatOnly && m.slug === "studio-booking"
              ? "My profile"
              : m.nav.label,
          iconKey: m.nav.icon,
        },
        sectionBadge([`addon:${m.slug}`], needsYou),
      ),
    );
  }
  if ((can(subject, "contacts", "read") && !seatOnly) || readsContent) {
    const parts = [
      "marketing",
      ...tabAddonSlugs(registry, input.active, "marketing")
        .filter(readable)
        .map((s) => `addon:${s}`),
    ];
    items.push(withBadge(MARKETING_NAV, sectionBadge(parts, needsYou)));
  }
  if (readsContent) items.push({ ...REPORTS_NAV });
  if (readsBusiness) {
    items.push(withBadge(SETTINGS_NAV, sectionBadge(["settings"], needsYou)));
  }
  const pinned: HubNavItem[] = [];
  if (can(subject, "addons", "read")) pinned.push({ ...GET_ADDONS });
  pinned.push({ ...HELP_NAV });
  if (!seatOnly) pinned.push({ ...SUPPORT_NAV });
  return { items, pinned };
}

/** One link in the top-right profile menu. */
export type ProfileMenuLink = { href: string; label: string };

/**
 * A&M fork: the profile menu lists only the person's own things. With their own seat (a
 * barber, or the owner's Employee seat): My page, My Social, Services & Pricing, Hours, My
 * bookings, My Rent and Alerts. No seat: just Alerts (the default "Your profile and alerts" link stays).
 */
export function profileMenuLinks(seatId: string | null): ProfileMenuLink[] {
  const alerts = { href: ALERTS_NAV.href, label: ALERTS_NAV.label };
  if (!seatId) return [alerts];
  const base = "/hub/studio-booking";
  const seat = `${base}/seats/${seatId}`;
  const q = `?seat=${seatId}`;
  const links: ProfileMenuLink[] = [
    { href: seat, label: "My page" },
    { href: `${base}/social${q}`, label: "My Social" },
    { href: `${base}/services${q}`, label: "Services & Pricing" },
    { href: `${seat}#hours`, label: "Hours" },
    { href: `${base}/bookings${q}`, label: "My bookings" },
  ];
  links.push({ href: `${base}/rent`, label: "My Rent" });
  links.push(alerts);
  return links;
}
