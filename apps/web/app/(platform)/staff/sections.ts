// Staff console sections (13-25 choice 1; STAFF-05, D311; 13-CONTEXT Area 2 "Sidebar (final
// order)"; 13-UI-SPEC "Shell", "Tabs"). The ONE tab source: the sidebar, every area page's
// TabLinks, StaffFind's "Screens" group and the page guards all read STAFF_SECTIONS. Tab ids
// come from @cds/core/staff STAFF_TAB_IDS (13-02); labels, icons, features and help slugs live
// here. Role gating goes through staffCan (STAFF_MATRIX), never a role literal.
// 13-47 adds sidebar counts through `staffNav(..., staffBadgeCounts(badges))` (Today read model).
import {
  STAFF_SECTION_KEYS,
  STAFF_TAB_IDS,
  type StaffSectionKey,
  type StaffTabId,
} from "@cds/core/staff";
import type { StaffRole } from "@cds/core";
import type { StaffFindEntry, StaffNavIcon, StaffNavItem } from "@cds/ui/staff";
import { staffCan } from "../../../lib/staff-session";

export type { StaffSectionKey, StaffTabId };

export type StaffTabDef<S extends StaffSectionKey = StaffSectionKey> = {
  id: StaffTabId<S>;
  label: string;
  /** STAFF_MATRIX feature that tab's main read needs (absent = the area's feature). */
  feature?: string;
  /**
   * The tab is visible to every console role, but its main controls are super_admin only
   * (UI-SPEC "Disabled with a reason": "Super Admin only" next to them).
   */
  superOnlyHint?: true;
};

export type StaffSectionDef<S extends StaffSectionKey = StaffSectionKey> = {
  key: S;
  href: string;
  label: string;
  icon: StaffNavIcon;
  /** STAFF_MATRIX feature that gates the whole area (requireStaff + sidebar). */
  feature: string;
  /** docs/how-to/<helpSlug>.md, baked into STAFF_HELP by 13-49 / 13-50. */
  helpSlug: string;
  tabs: readonly StaffTabDef<S>[];
};

type Sections = { [S in StaffSectionKey]: StaffSectionDef<S> };

/** CONTEXT Area 2 order. `sites` tabs are the site detail tabs (the list has none). */
export const STAFF_SECTIONS: Readonly<Sections> = Object.freeze({
  today: {
    key: "today",
    href: "/staff",
    label: "Today",
    icon: "House",
    feature: "console",
    helpSlug: "staff-today",
    tabs: [],
  },
  tickets: {
    key: "tickets",
    href: "/staff/tickets",
    label: "Tickets",
    icon: "LifeBuoy",
    feature: "support_read",
    helpSlug: "staff-tickets",
    tabs: [
      { id: "inbox", label: "Inbox" },
      { id: "incidents", label: "Incidents", feature: "incident_run" },
      {
        id: "windows",
        label: "Service windows",
        feature: "service_window_org",
      },
      { id: "ideas", label: "Ideas", feature: "ideas_run" },
      { id: "canned", label: "Canned replies", feature: "canned_replies" },
      { id: "ratings", label: "Ratings & SLA" },
    ],
  },
  pipeline: {
    key: "pipeline",
    href: "/staff/pipeline",
    label: "Pipeline",
    icon: "SquareKanban",
    feature: "leads_list",
    helpSlug: "staff-pipeline",
    tabs: [
      { id: "leads", label: "Leads" },
      { id: "fit", label: "Fit holds", superOnlyHint: true },
      { id: "building", label: "Building" },
      { id: "polish", label: "Polish queue" },
      { id: "launch", label: "Launch", superOnlyHint: true },
    ],
  },
  review: {
    key: "review",
    href: "/staff/review",
    label: "Review queue",
    icon: "ShieldCheck",
    feature: "review_queue",
    helpSlug: "staff-review",
    tabs: [
      { id: "flags", label: "Flags & holds" },
      { id: "spot", label: "Spot checks" },
      { id: "reports", label: "Reports & DMCA" },
    ],
  },
  sites: {
    key: "sites",
    href: "/staff/sites",
    label: "Sites",
    icon: "Globe",
    feature: "console",
    helpSlug: "staff-sites",
    tabs: [
      { id: "overview", label: "Overview" },
      { id: "addons", label: "Add-ons" },
      { id: "support", label: "Support", feature: "support_read" },
      { id: "media", label: "Media", feature: "media_usage" },
      { id: "indexing", label: "Indexing", feature: "indexing" },
      // P14 (14-51; D169, D-UI-P14-17): both roles read; Cancel move, Override and Move
      // domain are super_admin inside the panel (P14-P13).
      { id: "domain", label: "Domain", feature: "domains" },
      { id: "offboarding", label: "Offboarding", feature: "domains" },
      { id: "audit", label: "Audit" },
      { id: "actions", label: "Actions" },
    ],
  },
  catalog: {
    key: "catalog",
    href: "/staff/catalog",
    label: "Catalog",
    icon: "Package",
    feature: "catalog_listings",
    helpSlug: "staff-catalog",
    tabs: [
      { id: "addons", label: "Add-ons" },
      { id: "prices", label: "Prices", superOnlyHint: true },
      { id: "announcement", label: "Announcement", superOnlyHint: true },
    ],
  },
  health: {
    key: "health",
    href: "/staff/health",
    label: "Health",
    icon: "Activity",
    feature: "health",
    helpSlug: "staff-health",
    tabs: [
      { id: "platform", label: "Platform" },
      { id: "premium", label: "Premium" },
      {
        id: "failsafe",
        label: "Fail-safe requests",
        feature: "failsafe_requests",
      },
      { id: "jobs", label: "Jobs" },
      { id: "media", label: "Media usage", feature: "media_usage" },
      { id: "indexing", label: "Indexing", feature: "indexing" },
    ],
  },
  settings: {
    key: "settings",
    href: "/staff/settings",
    label: "Settings",
    icon: "Settings",
    feature: "staff_roles",
    helpSlug: "staff-settings",
    tabs: [
      { id: "staff", label: "Staff" },
      { id: "demo", label: "Demo tenant" },
      { id: "monitor", label: "Monitor" },
    ],
  },
} satisfies Sections);

/** Sidebar / tab attention counts (13-47). Absent = no badge. */
export type StaffCounts = Partial<Record<StaffSectionKey, number>> & {
  tabs?: Partial<Record<string, number>>;
};

/** The Today badge counts (staffTodayCounts().badges) as sidebar counts; null = no badge. */
export type StaffBadgeInput = {
  tickets: number | null;
  pipeline: number | null;
  review: number | null;
  health: number | null;
};

/**
 * Sidebar counts from the Today read model (13-47; UI-SPEC "Sidebar"): Tickets, Pipeline,
 * Review queue and Health only. A source that failed (null) or a read that failed (no input)
 * gives no badge, never a wrong one.
 */
export function staffBadgeCounts(
  badges: StaffBadgeInput | null | undefined,
): StaffCounts {
  if (!badges) return {};
  const out: StaffCounts = {};
  for (const key of ["tickets", "pipeline", "review", "health"] as const) {
    const n = badges[key];
    if (typeof n === "number" && n > 0) out[key] = n;
  }
  return out;
}

function first(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** `?tab=` for a section: a known tab id, else the section's first tab (UI-SPEC). */
export function parseStaffTab<S extends StaffSectionKey>(
  section: S,
  raw: unknown,
): StaffTabId<S> {
  const ids = STAFF_TAB_IDS[section] as readonly string[];
  const v = first(raw);
  if (typeof v === "string" && ids.includes(v)) return v as StaffTabId<S>;
  return ids[0] as StaffTabId<S>;
}

/** The link to one tab of an area (`base` for the site detail, `/staff/sites/<org>`). */
export function staffTabHref(
  section: StaffSectionKey,
  tab: string,
  base: string = STAFF_SECTIONS[section].href,
): string {
  const ids = STAFF_TAB_IDS[section] as readonly string[];
  return ids[0] === tab ? base : `${base}?tab=${encodeURIComponent(tab)}`;
}

/** Tabs for TabLinks, with neutral count suffixes ("Inbox · 7") when counts are known. */
export function staffTabLinks(
  section: StaffSectionKey,
  opts: { base?: string; counts?: StaffCounts["tabs"] } = {},
): { id: string; label: string; href: string }[] {
  const def = STAFF_SECTIONS[section] as StaffSectionDef;
  return def.tabs.map((t) => {
    const n = opts.counts?.[`${section}.${t.id}`];
    return {
      id: t.id,
      label: n && n > 0 ? `${t.label} · ${n}` : t.label,
      href: staffTabHref(section, t.id, opts.base),
    };
  });
}

/** True when `role` may open the area. */
export function staffCanSection(
  role: StaffRole | "" | null | undefined,
  section: StaffSectionKey,
): boolean {
  return staffCan(role, STAFF_SECTIONS[section].feature);
}

/** The section a console path belongs to (for `current`). */
export function staffSectionOf(
  path: string | null | undefined,
): StaffSectionKey {
  const p = (path ?? "").split(/[?#]/)[0] ?? "";
  for (const key of STAFF_SECTION_KEYS) {
    if (key === "today") continue;
    const href = STAFF_SECTIONS[key].href;
    if (p === href || p.startsWith(`${href}/`)) return key;
  }
  return "today";
}

/** The shell's nav: the fixed order, filtered by staffCan (Settings absent for agents). */
export function staffNav(
  role: StaffRole | "" | null | undefined,
  current: StaffSectionKey | null,
  counts?: StaffCounts,
): StaffNavItem[] {
  const items: StaffNavItem[] = [];
  for (const key of STAFF_SECTION_KEYS) {
    if (!staffCanSection(role, key)) continue;
    const s = STAFF_SECTIONS[key];
    const badge = counts?.[key];
    items.push({
      key,
      href: s.href,
      label: s.label,
      icon: s.icon,
      ...(badge && badge > 0 ? { badge } : {}),
      ...(current === key ? { current: true } : {}),
    });
  }
  return items;
}

/**
 * StaffFind's "Screens" group: every area and tab the role may open. Tickets, Sites and Cases
 * come from the server search (13-47 findAction -> staffFind). The site detail tabs need an
 * org, so only the Sites list is listed.
 */
export function staffScreensIndex(
  role: StaffRole | "" | null | undefined,
): StaffFindEntry[] {
  const out: StaffFindEntry[] = [];
  for (const key of STAFF_SECTION_KEYS) {
    if (!staffCanSection(role, key)) continue;
    const s = STAFF_SECTIONS[key] as StaffSectionDef;
    out.push({ group: "Screens", label: s.label, href: s.href });
    if (key === "sites") continue;
    for (const t of s.tabs) {
      out.push({
        group: "Screens",
        label: t.label,
        href: staffTabHref(key, t.id),
        path: `${s.label} › ${t.label}`,
      });
    }
  }
  return out;
}

/** "Super Admin" / "Support agent", from the matrix (no role literals here). */
export function staffRoleLabel(
  role: StaffRole | "" | null | undefined,
): string {
  return staffCan(role, "staff_roles") ? "Super Admin" : "Support agent";
}
