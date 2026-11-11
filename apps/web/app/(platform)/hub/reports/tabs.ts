// Reports page tabs (11-14; 11-UI-SPEC "Hub shell" Tab bars: Reports › Site Report · Social;
// DASH-25). One REPORTS_TABS array, read through HUB_SECTIONS by the sidebar, tab bar and
// Jump to. Tabs are real `?tab=` links read from the server searchParams. Unknown -> Site
// Report. Pure.

export const REPORTS_TABS = [
  { id: "site", label: "Site Report" },
  { id: "social", label: "Social" },
] as const;

export type ReportsTabId = (typeof REPORTS_TABS)[number]["id"];

export function resolveReportsTab(raw: unknown): ReportsTabId {
  const value = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  const hit = REPORTS_TABS.find((t) => t.id === value);
  return hit ? hit.id : "site";
}

export function reportsTabHref(id: ReportsTabId): string {
  return `/hub/reports?tab=${encodeURIComponent(id)}`;
}
