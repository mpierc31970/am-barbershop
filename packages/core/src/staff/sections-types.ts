// Staff console sections and tab ids (13-02; 13-UI-SPEC "?tab=" values, CONTEXT order).
// Pure types plus the tab id lists; labels, icons and features live in
// apps/web/app/(platform)/staff/sections.ts (13-25).

export const STAFF_SECTION_KEYS = [
  "today",
  "tickets",
  "pipeline",
  "review",
  "sites",
  "catalog",
  "health",
  "settings",
] as const;

export type StaffSectionKey = (typeof STAFF_SECTION_KEYS)[number];

/** Tab ids per section, first tab is the default. `sites` lists the site detail tabs. */
export const STAFF_TAB_IDS = {
  today: [],
  tickets: ["inbox", "incidents", "windows", "ideas", "canned", "ratings"],
  pipeline: ["leads", "fit", "building", "polish", "launch"],
  review: ["flags", "spot", "reports"],
  sites: [
    "overview",
    "addons",
    "support",
    "media",
    "indexing",
    "domain",
    "offboarding",
    "audit",
    "actions",
  ],
  catalog: ["addons", "prices", "announcement"],
  health: ["platform", "premium", "failsafe", "jobs", "media", "indexing"],
  settings: ["staff", "demo", "monitor"],
} as const satisfies Record<StaffSectionKey, readonly string[]>;

export type StaffTabId<S extends StaffSectionKey = StaffSectionKey> =
  (typeof STAFF_TAB_IDS)[S][number];
