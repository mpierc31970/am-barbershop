// Website page tabs (D311 DCR admin pattern, donor SiteContent.tsx L20-56; UI-SPEC "Hub
// shell"; 05-UI-SPEC "Hub shell changes"; 06-UI-SPEC "Hub shell changes"). WEBSITE_TABS is
// the core source (Pages · Services · Media · Forms · Navigation · Footer · Banner · Pop-ups ·
// Site settings; order from 07-UI-SPEC D-UI-P7-2, 07-03; D311 puts Services second, 06-22);
// Services lists business details, so it follows the business read rule (Owner, Admin,
// Editor read-only; never a Viewer). composeWebsiteTabs appends the org's installed tab add-ons in manifest order and
// filters both by the member's permissions, on the server (CONTEXT A4-Q3, T-05-59). Tabs are
// real `?tab=` links read from the server searchParams, so they are shareable and survive a
// refresh. Pure.
import { can, type OrgRole } from "@cds/core";
import type { AddonManifest } from "@cds/core/addons";

export type WebsiteTab = { readonly id: string; readonly label: string };

export const WEBSITE_TABS: readonly WebsiteTab[] = [
  { id: "pages", label: "Pages" },
  { id: "services", label: "Services" },
  { id: "media", label: "Media" },
  { id: "forms", label: "Forms" },
  { id: "navigation", label: "Navigation" },
  { id: "footer", label: "Footer" },
  { id: "banner", label: "Banner" },
  { id: "popups", label: "Pop-ups" },
  { id: "site", label: "Site settings" },
];

/**
 * Body of a tab whose owning plan has not built it yet (07-03 shells). 07-16, 07-17, 07-18,
 * 07-19, 07-25 and 07-26 replace every use; 07-33's completeness pass confirms no import of
 * it remains.
 */
export const SHELL_PANEL_BODY = "This part of your hub isn't ready yet.";

export type WebsiteTabId = (typeof WEBSITE_TABS)[number]["id"];

/** Core tabs that need more than content read (the business details they list). */
const BUSINESS_TABS: ReadonlySet<string> = new Set(["services"]);

/**
 * The member's Website tabs: the core tabs when they can read content, then each installed
 * add-on tab (already in manifest order) they may read. A member whose only access is an
 * `addon:<slug>` grant sees exactly the granted add-on tabs.
 */
export function composeWebsiteTabs(input: {
  core: readonly WebsiteTab[];
  installed: readonly { slug: string; label: string }[];
  role: OrgRole;
  grants: readonly string[];
}): WebsiteTab[] {
  const subject = { role: input.role, grants: input.grants };
  const readsBusiness = can(subject, "business", "read");
  const tabs: WebsiteTab[] = can(subject, "content", "read")
    ? input.core
        .filter((t) => readsBusiness || !BUSINESS_TABS.has(t.id))
        .map((t) => ({ id: t.id, label: t.label }))
    : [];
  const seen = new Set(tabs.map((t) => t.id));
  for (const a of input.installed) {
    if (seen.has(a.slug)) continue;
    if (!can(subject, `addon:${a.slug}`, "read")) continue;
    seen.add(a.slug);
    tabs.push({ id: a.slug, label: a.label });
  }
  return tabs;
}

/**
 * A valid tab id from the raw `?tab=` value. Unknown -> the first tab. A known add-on slug
 * that is not among the tabs (removed since it was bookmarked) -> the first tab, with
 * fallbackFrom naming it so the page can say it is off. `id` is "" when there are no tabs.
 */
export function resolveTab(
  raw: string | string[] | undefined,
  tabs: readonly WebsiteTab[] = WEBSITE_TABS,
  knownAddonSlugs: readonly string[] = [],
): { id: string; fallbackFrom: string | null } {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const first = tabs[0]?.id ?? "";
  if (typeof value !== "string") return { id: first, fallbackFrom: null };
  if (tabs.some((t) => t.id === value)) {
    return { id: value, fallbackFrom: null };
  }
  return {
    id: first,
    fallbackFrom: knownAddonSlugs.includes(value) ? value : null,
  };
}

/** "Testimonials is off. Add it back from Get add-ons to see your testimonials." */
export function offCopy(m: Pick<AddonManifest, "name" | "records">): string {
  const [first] = Object.values(m.records);
  const plural = first?.plural ?? "items";
  return `${m.name} is off. Add it back from Get add-ons to see your ${plural}.`;
}

/**
 * PAUSED-TAB (10-32; 10-UI-SPEC "Paused add-ons", BILL-03, D27): the bookmarked tab of an
 * add-on paused by a billing lapse. "Testimonials is paused because payment stopped. Pay
 * from Settings › Billing to see your testimonials again."
 */
export function pausedTabCopy(
  m: Pick<AddonManifest, "name" | "records">,
): string {
  const [first] = Object.values(m.records);
  const plural = first?.plural ?? "items";
  return `${m.name} is paused because payment stopped. Pay from Settings › Billing to see your ${plural} again.`;
}

export function tabHref(id: string): string {
  return `?tab=${encodeURIComponent(id)}`;
}
