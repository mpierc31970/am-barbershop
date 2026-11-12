// Settings page tabs (06-22; 06-UI-SPEC "Settings"; D311 DCR admin pattern, PD-21). One
// SETTINGS_TABS array: Business info · Team & hours · Email · Legal (09-20, last; Owner and
// Admin only, the page filters it). Payments (10-25; Owner interactive, Admin read-only,
// `connect:read`) sits before Legal; Billing (10-29; Owner only, `billing:read`) sits between
// Payments and Legal. People & roles (11-39; Owner manages, Admin reads, `members:read`) sits
// between Email and Payments (11-UI-SPEC tab order). Domain (14-31; D-UI-P14-1; Owner acts,
// Admin reads, `domain:read`) sits after Email; Integrations (14-32; D-UI-P14-1; read-only,
// Owner and Admin, `domain:read`) sits after Billing. Tabs are real
// `?tab=` links read from the server searchParams. Unknown -> Business info. Pure.

export const SETTINGS_TABS = [
  { id: "business", label: "Business info" },
  { id: "team-hours", label: "Team & hours" },
  { id: "email", label: "Email" },
  { id: "domain", label: "Domain" },
  { id: "people", label: "People & roles" },
  { id: "payments", label: "Payments" },
  { id: "billing", label: "Billing" },
  { id: "integrations", label: "Integrations" },
  { id: "legal", label: "Legal" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

/** A&M fork: the shop takes payment in store only, so Stripe Payments and CDS Billing are off. */
export const HIDDEN_SETTINGS_TABS: ReadonlySet<SettingsTabId> = new Set([
  "payments",
  "billing",
]);

export function resolveSettingsTab(raw: unknown): SettingsTabId {
  const value = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  const hit = SETTINGS_TABS.find(
    (t) => t.id === value && !HIDDEN_SETTINGS_TABS.has(t.id),
  );
  return hit ? hit.id : "business";
}

/** The only `next` Settings honours (WR-D06): the launch review's Key facts step. */
export const REVIEW_FACTS_RETURN = "/hub/review?step=facts";

/**
 * WR-D06: the "Back to your review" target for `?next=`, or null. Strict allowlist (one exact
 * path), so `next` can never become an open redirect.
 */
export function reviewReturnHref(raw: unknown): string | null {
  const value = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  return value === REVIEW_FACTS_RETURN ? REVIEW_FACTS_RETURN : null;
}

export function settingsTabHref(id: SettingsTabId): string {
  return `/hub/settings?tab=${encodeURIComponent(id)}`;
}

/** Per-tab counts shown on the label (09-20 choice 1). */
export type SettingsTabCounts = Partial<Record<SettingsTabId, number>>;

/**
 * "Email · 1" while a route bounces (06-UI-SPEC Email routing item 5); "Legal · 1" when the
 * terms are outdated or a site policy update waits (09-UI-SPEC "Settings › Legal");
 * "Payments · 1" when Stripe stopped after having been connected; "Billing · n" for past due /
 * paused plus quotes waiting (10-UI-SPEC Settings tabs); "Domain · 1" while the owner has a
 * domain step or something is broken (14-31 choice 1).
 */
export function settingsTabLabel(
  id: SettingsTabId,
  counts: SettingsTabCounts,
): string {
  const label = SETTINGS_TABS.find((t) => t.id === id)?.label ?? "";
  const n = counts[id] ?? 0;
  return n > 0 ? `${label} · ${n}` : label;
}
