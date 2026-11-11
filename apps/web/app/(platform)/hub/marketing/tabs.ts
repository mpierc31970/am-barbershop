// Marketing page tabs (CONTACTS-01; D311, 07-UI-SPEC "Hub shell changes (D311)", "Contacts",
// D-UI-P7-1; 07-03). One MARKETING_TABS array: Contacts and Social (11-37); P12 appends
// Newsletter. Tabs are real `?tab=` links read from the server searchParams.
// Unknown -> Contacts. Pure. 11-14: composeMarketingTabs appends add-on tabs placed under
// Marketing (DASH-26). 11-37: Social (after Contacts) for content readers; Contacts stays
// with contacts readers, so each core tab carries its own gate (MARKETING_TAB_FEATURE).
import { can, type OrgRole } from "@cds/core";

export const MARKETING_TABS = [
  { id: "contacts", label: "Contacts" },
  { id: "social", label: "Social" },
] as const;

/** The feature whose read permission shows each core tab (11-37 choice 1). */
export const MARKETING_TAB_FEATURE: Readonly<Record<string, string>> =
  Object.freeze({ contacts: "contacts", social: "content" });

export type MarketingTabId = (typeof MARKETING_TABS)[number]["id"];

/**
 * The requested tab when it is one of `allowed` (default: every core tab), else the first
 * allowed tab (Contacts for contacts readers, Social for Editors and Viewers).
 */
export function resolveMarketingTab(
  raw: unknown,
  allowed: readonly MarketingTabId[] = MARKETING_TABS.map((t) => t.id),
): MarketingTabId {
  const value = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  const hit = allowed.find((id) => id === value);
  return hit ?? allowed[0] ?? "contacts";
}

/** Core tabs a member may open (the page guard and HUB_SECTIONS share this). */
export function readableMarketingTabs(subject: {
  role: OrgRole;
  grants: readonly string[];
}): MarketingTabId[] {
  return MARKETING_TABS.filter((t) =>
    can(subject, MARKETING_TAB_FEATURE[t.id] ?? "contacts", "read"),
  ).map((t) => t.id);
}

export function marketingTabHref(id: MarketingTabId): string {
  return `/hub/marketing?tab=${encodeURIComponent(id)}`;
}

export type MarketingTab = { readonly id: string; readonly label: string };

/**
 * The member's Marketing tabs (11-14, DASH-26; mirrors composeWebsiteTabs): each core tab
 * the member may read (Contacts: contacts read; Social: content read; 11-37), then each installed add-on whose manifest puts its tab under
 * Marketing (`nav.item === "marketing"`, already in manifest order) that they may read.
 * Installing places the tab; uninstalling (not in `installed`) removes it. Pure, server-side.
 */
export function composeMarketingTabs(input: {
  core?: readonly MarketingTab[];
  installed: readonly { slug: string; label: string }[];
  role: OrgRole;
  grants: readonly string[];
}): MarketingTab[] {
  const subject = { role: input.role, grants: input.grants };
  const core = input.core ?? MARKETING_TABS;
  const tabs: MarketingTab[] = core
    .filter((t) =>
      can(subject, MARKETING_TAB_FEATURE[t.id] ?? "contacts", "read"),
    )
    .map((t) => ({ id: t.id, label: t.label }));
  const seen = new Set(tabs.map((t) => t.id));
  for (const a of input.installed) {
    if (seen.has(a.slug)) continue;
    if (!can(subject, `addon:${a.slug}`, "read")) continue;
    seen.add(a.slug);
    tabs.push({ id: a.slug, label: a.label });
  }
  return tabs;
}
