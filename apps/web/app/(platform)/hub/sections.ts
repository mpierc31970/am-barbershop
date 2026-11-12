// HUB_SECTIONS: the one section and tab source (11-14; DASH-25, DASH-26, DASH-27; 11-UI-SPEC
// "Hub shell" Tab bars; RESEARCH Pattern 1). The sidebar (nav.ts), every section's tab bar,
// the tab count suffixes and the Jump-to index (jump-index.ts) read the same table, so a tab
// never exists in one place and not another. Each section's `tabs(input)` returns only the
// tabs the person may see (filtered on the server by `can()`, T-11-14-01), with a count from
// the person's already grant-filtered Needs-you list (`groupCounts().byTab`, T-11-14-02); a
// section whose Needs-you provider failed carries no counts.
//   - Website: composeWebsiteTabs (core + add-ons with nav.item "website").
//   - Settings: SETTINGS_TABS, with the role filtering the Settings page applies (People &
//     roles needs members:read, Payments connect:read, Billing billing:read, Legal
//     agreements:read, Domain domain:read (14-31)).
//   - Marketing: composeMarketingTabs (core + add-ons with nav.item "marketing").
//   - Reports: REPORTS_TABS (Site Report, Social).
//   - Inbox: Messages, Filtered. Today and Help have no tabs.
//   - CDS Support (12-19; D311, COMM-05): SUPPORT_TABS Messages · Tickets · Documents · Ideas
//     for anyone with support:read (grants-only roles get none, P12-P11); counts read
//     `byTab["support:messages"]` / `["support:tickets"]`. Each support tab opens its own
//     P12 article (12-33, SUPPORT_TAB_HELP); the section itself keeps "support". Its
//     `jumpActions` add "Get help" (new ticket, help id "support.get-help") to Jump to for
//     people with support:write.
// Each tab has a `helpId` of `<section>.<tab>` that the help system (11-46) resolves.
// Existing pages keep their own tab rendering until 11-16 / 11-46 switch them to this table.
// Pure.
import { can, type OrgRole } from "@cds/core";
import type { AddonManifest, AddonRegistry } from "@cds/core/addons";
import { groupCounts } from "@cds/core/today";
import { composeMarketingTabs } from "./marketing/tabs";
import {
  CORE_SEGMENTS,
  type HubNavItem,
  type HubNeedsYou,
  sectionFailed,
} from "./nav";
import { REPORTS_TABS } from "./reports/tabs";
import { HELP_ALIASES } from "../../../lib/help-index";
import { HIDDEN_SETTINGS_TABS, SETTINGS_TABS } from "./settings/tabs";
import { WEBSITE_TABS, composeWebsiteTabs } from "./website/tabs";

export type HubSectionKey =
  | "today"
  | "inbox"
  | "website"
  | "marketing"
  | "reports"
  | "settings"
  | "help"
  | "support";

export type SectionTab = {
  id: string;
  label: string;
  href: string;
  /** Needs-you items on this tab; absent at zero or when the section's provider failed. */
  count?: number;
  /** `<section>.<tab>`, resolved by the help system (11-46). */
  helpId: string;
  /**
   * A Jump-to-only entry from the section's `jumpActions` (12-19), never a tab. Only
   * composeSectionTabs adds these; `section.tabs()` (what TabLinks renders) never does.
   */
  jumpOnly?: true;
  /** Extra Jump-to match words. */
  keywords?: string;
};

export type SectionTabsInput = {
  role: OrgRole;
  grants: readonly string[];
  /** The org's active add-on slugs. */
  active: readonly string[];
  registry: AddonRegistry;
  needsYou?: HubNeedsYou;
};

export type HubSection = {
  key: HubSectionKey;
  href: string;
  label: string;
  iconKey: HubNavItem["iconKey"];
  helpId: string;
  tabs(input: SectionTabsInput): SectionTab[];
  /** Screens reached from this section that are not tabs (Jump to only; 12-19). */
  jumpActions?(input: SectionTabsInput): SectionTab[];
};

/** Active add-ons whose tab sits under one section, in manifest order. */
function installedTabs(
  input: SectionTabsInput,
  item: "website" | "marketing",
): { slug: string; label: string }[] {
  const on = new Set(input.active);
  return input.registry
    .list()
    .filter(
      (m: AddonManifest) =>
        on.has(m.slug) &&
        m.nav.placement === "tab" &&
        m.nav.item === item &&
        !CORE_SEGMENTS.has(m.slug),
    )
    .map((m) => ({ slug: m.slug, label: m.nav.label }));
}

function sectionHref(base: string, id: string): string {
  return `${base}?tab=${encodeURIComponent(id)}`;
}

/**
 * Builds the tab list for one section: hrefs, help ids and Needs-you counts. A core tab's
 * count is `byTab["<section>:<tab>"]`; an add-on tab's count is its own section
 * (`addon:<slug>`), which the add-on's items use.
 */
function withCounts(
  section: HubSectionKey,
  base: string,
  tabs: readonly { id: string; label: string }[],
  input: SectionTabsInput,
  addonSlugs: ReadonlySet<string> = new Set(),
): SectionTab[] {
  const ny = input.needsYou;
  const counts = ny ? groupCounts(ny.items) : null;
  return tabs.map((t) => {
    const out: SectionTab = {
      id: t.id,
      label: t.label,
      href: sectionHref(base, t.id),
      helpId: `${section}.${t.id}`,
    };
    if (!ny || !counts) return out;
    const isAddon = addonSlugs.has(t.id);
    const bucket = isAddon ? `addon:${t.id}` : section;
    if (sectionFailed(bucket, ny.failed)) return out;
    const n = isAddon
      ? (counts.bySection[bucket] ?? 0)
      : (counts.byTab[`${section}:${t.id}`] ?? 0);
    return n > 0 ? { ...out, count: n } : out;
  });
}

function settingsTabs(input: SectionTabsInput): SectionTab[] {
  const subject = { role: input.role, grants: input.grants };
  if (!can(subject, "business", "read")) return [];
  const visible = SETTINGS_TABS.filter(
    (t) =>
      !HIDDEN_SETTINGS_TABS.has(t.id) &&
      (t.id !== "legal" || can(subject, "agreements", "read")) &&
      (t.id !== "people" || can(subject, "members", "read")) &&
      (t.id !== "payments" || can(subject, "connect", "read")) &&
      (t.id !== "billing" || can(subject, "billing", "read")) &&
      (t.id !== "domain" || can(subject, "domain", "read")) &&
      (t.id !== "integrations" || can(subject, "domain", "read")),
  );
  return withCounts("settings", "/hub/settings", visible, input).map((t) =>
    t.id === "domain" || t.id === "integrations"
      ? { ...t, helpId: settingsTabHelpId(t.id) }
      : t,
  );
}

/**
 * The help id behind a Settings tab's "?" (14-31 choice 3, P13-P12 pattern): `settings.<tab>`,
 * except Domain, which points at its how-to only once the help map knows it (14-46 adds the
 * `settings.domain` alias). Until then it opens the Settings article, never a missing one.
 */
export function settingsTabHelpId(tab: string): string {
  const id = `settings.${tab}`;
  // 14-32: Integrations follows the same rule until its how-to exists (14-46).
  if (tab !== "domain" && tab !== "integrations") return id;
  return Object.prototype.hasOwnProperty.call(HELP_ALIASES, id)
    ? id
    : "settings";
}

function websiteTabs(input: SectionTabsInput): SectionTab[] {
  const installed = installedTabs(input, "website");
  const tabs = composeWebsiteTabs({
    core: WEBSITE_TABS,
    installed,
    role: input.role,
    grants: input.grants,
  });
  return withCounts(
    "website",
    "/hub/website",
    tabs,
    input,
    new Set(installed.map((a) => a.slug)),
  );
}

function marketingTabs(input: SectionTabsInput): SectionTab[] {
  const installed = installedTabs(input, "marketing");
  const tabs = composeMarketingTabs({
    installed,
    role: input.role,
    grants: input.grants,
  });
  return withCounts(
    "marketing",
    "/hub/marketing",
    tabs,
    input,
    new Set(installed.map((a) => a.slug)),
  );
}

const INBOX_TABS = [
  { id: "messages", label: "Messages" },
  { id: "filtered", label: "Filtered" },
] as const;

/** CDS Support tabs (12-19; D311; UI-SPEC "Support frame"). Unknown `?tab=` → messages. */
export const SUPPORT_TABS = [
  { id: "messages", label: "Messages" },
  { id: "tickets", label: "Tickets" },
  { id: "documents", label: "Documents" },
  { id: "ideas", label: "Ideas" },
] as const;

export type SupportTabId = (typeof SUPPORT_TABS)[number]["id"];

/** The new-ticket form ("Get help"; 12-20 builds it). */
export const SUPPORT_NEW_TICKET_HREF = "/hub/support/tickets/new";

/**
 * Each Support tab's "?" (12-33): its own P12 training id (packages/core/training/p12). The
 * section row keeps "support" (the CDS Support how-to).
 */
export const SUPPORT_TAB_HELP: Readonly<Record<SupportTabId, string>> =
  Object.freeze({
    messages: "support.messages",
    tickets: "support.follow-ticket",
    documents: "support.documents",
    ideas: "support.ideas",
  });

/** The Get help form's article (12-33). */
export const SUPPORT_GET_HELP_HELP_ID = "support.get-help";

function supportTabs(input: SectionTabsInput): SectionTab[] {
  if (!can({ role: input.role, grants: input.grants }, "support", "read")) {
    return [];
  }
  return withCounts("support", "/hub/support", SUPPORT_TABS, input).map(
    (t) => ({ ...t, helpId: SUPPORT_TAB_HELP[t.id as SupportTabId] }),
  );
}

function supportJumpActions(input: SectionTabsInput): SectionTab[] {
  if (!can({ role: input.role, grants: input.grants }, "support", "write")) {
    return [];
  }
  return [
    {
      id: "get-help",
      label: "Get help",
      href: SUPPORT_NEW_TICKET_HREF,
      helpId: SUPPORT_GET_HELP_HELP_ID,
      jumpOnly: true,
      keywords: "ticket new problem report broken change request",
    },
  ];
}

const none = (): SectionTab[] => [];

export const HUB_SECTIONS: Readonly<Record<HubSectionKey, HubSection>> =
  Object.freeze({
    today: {
      key: "today",
      href: "/hub/today",
      label: "Today",
      iconKey: "House",
      helpId: "today",
      tabs: none,
    },
    inbox: {
      key: "inbox",
      href: "/hub/inbox",
      label: "Inbox",
      iconKey: "Inbox",
      helpId: "inbox",
      tabs: (input) =>
        can({ role: input.role, grants: input.grants }, "content", "read")
          ? withCounts("inbox", "/hub/inbox", INBOX_TABS, input)
          : [],
    },
    website: {
      key: "website",
      href: "/hub/website",
      label: "Website",
      iconKey: "Globe",
      helpId: "website",
      tabs: websiteTabs,
    },
    marketing: {
      key: "marketing",
      href: "/hub/marketing",
      label: "Marketing",
      iconKey: "Megaphone",
      helpId: "marketing",
      tabs: marketingTabs,
    },
    reports: {
      key: "reports",
      href: "/hub/reports",
      label: "Reports",
      iconKey: "ChartColumn",
      helpId: "reports",
      tabs: (input) =>
        can({ role: input.role, grants: input.grants }, "content", "read")
          ? withCounts("reports", "/hub/reports", REPORTS_TABS, input)
          : [],
    },
    settings: {
      key: "settings",
      href: "/hub/settings",
      label: "Settings",
      iconKey: "Settings",
      helpId: "settings",
      tabs: settingsTabs,
    },
    help: {
      key: "help",
      href: "/hub/help",
      label: "Help",
      iconKey: "CircleHelp",
      helpId: "help",
      tabs: none,
    },
    support: {
      key: "support",
      href: "/hub/support",
      label: "Support",
      iconKey: "LifeBuoy",
      helpId: "support",
      tabs: supportTabs,
      jumpActions: supportJumpActions,
    },
  });

/** The HUB_SECTIONS entry behind a sidebar href, or null (setup, add-ons, sidebar add-ons). */
export function sectionForHref(href: string): HubSection | null {
  const path = href.split(/[?#]/, 1)[0] ?? href;
  for (const s of Object.values(HUB_SECTIONS)) {
    if (s.href === path) return s;
  }
  return null;
}

function sectionEntries(
  section: HubSection,
  input: SectionTabsInput,
): SectionTab[] {
  return [...section.tabs(input), ...(section.jumpActions?.(input) ?? [])];
}

/**
 * Tabs for every section the person's sidebar shows, keyed by the item's href (the shape
 * buildJumpIndex reads). Only items already in the grant-filtered nav get tabs. A section's
 * `jumpActions` follow its tabs, marked `jumpOnly` (never render these as tabs).
 */
export function composeSectionTabs(
  input: SectionTabsInput & { nav: readonly HubNavItem[] },
): Record<string, SectionTab[]> {
  const out: Record<string, SectionTab[]> = {};
  for (const item of input.nav) {
    const section = sectionForHref(item.href);
    if (!section) continue;
    out[item.href] = sectionEntries(section, input);
  }
  // Help and CDS Support are pinned for everyone (nav.ts composeHubNav), outside `nav.items`;
  // their tabs are still Jump-to entries (12-19). Each section gates its own tabs by can().
  for (const section of [HUB_SECTIONS.help, HUB_SECTIONS.support]) {
    if (Object.hasOwn(out, section.href)) continue;
    const entries = sectionEntries(section, input);
    if (entries.length > 0) out[section.href] = entries;
  }
  return out;
}

export { composeMarketingTabs };
