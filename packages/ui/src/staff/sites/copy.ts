// Sites copy and pure helpers (13-33; STAFF-02; 13-UI-SPEC "Sites" lines 763-805, "Staff status
// tone map" lines 190-221). The words the Sites list and site detail cells use, in one place.
// Copy IDs stay in P13_COPY (@cds/core/staff). Pure and browser-safe; no @cds/db import, so the
// view types below mirror the @cds/db read model (the panel maps rows into them).
import type { BadgeTone } from "../../hub/Badge";

/** Mirrors @cds/db StaffSiteState. */
export type SiteStateView =
  | "live"
  | "building"
  | "held"
  | "suspended"
  | "notice"
  | "closed"
  | "lapsed"
  | "intake"
  | "fit_review"
  | "ready_for_build"
  | "ready_for_review";

export const SITE_STATE_BADGE: Readonly<
  Record<SiteStateView, { tone: BadgeTone; label: string }>
> = {
  live: { tone: "live", label: "Live" },
  building: { tone: "being-built", label: "Building" },
  ready_for_review: { tone: "ready-review", label: "Ready for review" },
  intake: { tone: "s-intake", label: "Intake" },
  fit_review: { tone: "s-fit", label: "Fit review" },
  ready_for_build: { tone: "s-ready", label: "Ready for build" },
  held: { tone: "s-held", label: "Held" },
  notice: { tone: "s-notice", label: "Notice" },
  suspended: { tone: "s-suspended", label: "Suspended" },
  closed: { tone: "s-closed", label: "Closed" },
  lapsed: { tone: "s-lapsed", label: "Lapsed" },
};

/** Default list order (UI-SPEC: suspended, notice, held, building, review, live, others). */
export const SITE_STATE_GROUP: Readonly<Record<SiteStateView, number>> = {
  suspended: 0,
  notice: 1,
  held: 2,
  building: 3,
  ready_for_review: 4,
  live: 5,
  fit_review: 6,
  ready_for_build: 6,
  intake: 6,
  lapsed: 7,
  closed: 8,
};

export const SITE_PATH_LABELS: Readonly<Record<string, string>> = {
  standard: "Standard",
  studio: "Studio",
  shop: "Shop",
};

export const SITES_COPY = {
  caption: "Sites, most urgent status first",
  empty: "No sites match.",
  demo: "Demo",
  repeat: "3 upheld DMCA",
  repeatTitle: "3 or more upheld DMCA cases in the last 365 days",
  preview: "preview",
  noPlan: "No plan yet",
  carePlan: "Care Plan",
  none: "—",
  cols: {
    business: "Business",
    status: "Status",
    path: "Path",
    plan: "Plan",
    addons: "Add-ons",
    host: "Host",
    created: "Created",
    lastOwner: "Last owner activity",
    openTickets: "Open tickets",
  },
  openTicketsLink: (n: number) =>
    n === 1 ? "1 open ticket" : `${n} open tickets`,
  resultLine: (n: number) => (n === 1 ? "1 site" : `${n} sites`),
  // Site detail.
  overview: {
    details: "Site",
    stage: "Status",
    path: "Path",
    plan: "Plan",
    carePlan: "Care Plan",
    billing: "Billing",
    domains: "Domains",
    demo: "Demo site",
    suspension: "Suspension",
    created: "Created",
    orgId: "Org id",
    members: "Members",
    recent: "Recent activity",
    noMembers: "No members yet.",
    noRecent: "Nothing yet.",
    yes: "Yes",
    no: "No",
    copyId: "Copy org id",
    copied: "Copied",
    liveLabel: "Live",
    previewLabel: "Preview",
    noDomain: "No domain yet",
    allAudit: "See the full audit log",
  },
  billing: {
    active: "Paid",
    trialing: "Trial",
    past_due: "Unpaid",
    unpaid: "Unpaid",
    lapsed: "Lapsed",
    canceled: "Cancelled",
    none: "No billing yet",
    renews: (date: string) => `next invoice ${date}`,
  },
  suspension: {
    none: "None",
    notice: (fixBy: string) => `Notice sent · fix by ${fixBy}`,
    suspended: (date: string) => `Suspended on ${date}`,
    lifted: "Lifted",
    fixed: "Marked fixed",
  },
  addons: {
    caption: "Add-ons on this site",
    cols: { addon: "Add-on", state: "State", since: "Since", price: "Price" },
    onSite: "On site",
    removed: "Removed",
    notAdded: "Not on site",
    install: "Install add-on",
    uninstall: "Uninstall add-on",
    priceSoon: "Price coming soon",
    reason: "Reason",
    installed: (name: string) => `${name} installed.`,
    uninstalled: (name: string) => `${name} uninstalled. Its content is kept.`,
    empty: "No add-ons for this site's path.",
    action: "Action",
  },
  tickets: {
    caption: "This site's tickets, most urgent first",
    cols: {
      number: "#",
      subject: "Subject",
      type: "Type",
      status: "Status",
      priority: "Priority",
      sla: "SLA",
      assignee: "Assignee",
    },
    empty: "No tickets for this site.",
    openTicket: "Open ticket for this site",
    unassigned: "Unassigned",
  },
  audit: {
    caption: "This site's audit log, newest first",
    cols: { time: "Time", actor: "Actor", action: "Action", target: "Target" },
    empty: "No audit rows.",
    filters: { all: "All", cds: "CDS actions", impersonation: "Impersonation" },
    filterLabel: "Show",
    cds: "CDS",
    system: "CDS (system)",
    unknown: "Someone",
    newer: "Newer",
    older: "Older",
    page: (p: number, total: number) => `Page ${p} of ${total}`,
  },
} as const;

/** "CDS · Lee" for staff rows (console and impersonation), "CDS (system)" for job rows. */
export function auditActorLabel(row: {
  actorName: string;
  byStaff: boolean;
  impersonatorName: string;
  system?: boolean;
}): string {
  const A = SITES_COPY.audit;
  if (row.byStaff) {
    const who = row.impersonatorName.trim();
    return who ? `${A.cds} · ${who}` : A.cds;
  }
  if (row.system) return A.system;
  return row.actorName.trim() || A.unknown;
}

/** PocketBase "2026-10-01 10:00:00.000Z" or ISO; null when empty or unparsable. */
export function siteDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Oct 15, 2026" in the business time zone; "—" when missing. */
export function formatSiteDate(
  value: string | null | undefined,
  tz = "America/Chicago",
): string {
  const d = siteDate(value);
  if (!d) return SITES_COPY.none;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    dateStyle: "medium",
  }).format(d);
}

/** "Oct 15, 2026, 3:04 PM" in the business time zone; "—" when missing. */
export function formatSiteDateTime(
  value: string | null | undefined,
  tz = "America/Chicago",
): string {
  const d = siteDate(value);
  if (!d) return SITES_COPY.none;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/** "Monthly · Care Plan" / "No plan yet". */
export function sitePlanLabel(plan: string, carePlan: boolean): string {
  const base =
    plan === ""
      ? SITES_COPY.noPlan
      : plan.charAt(0).toUpperCase() + plan.slice(1);
  return carePlan ? `${base} · ${SITES_COPY.carePlan}` : base;
}

export function sitePathLabel(path: string): string {
  return SITE_PATH_LABELS[path] ?? SITES_COPY.none;
}

/** Billing state words; unknown states read as the raw value, capitalised. */
export function siteBillingLabel(state: string): string {
  const map = SITES_COPY.billing as unknown as Record<string, unknown>;
  const v = map[state];
  if (typeof v === "string") return v;
  return state ? state.charAt(0).toUpperCase() + state.slice(1) : "";
}

/** Billing states shown with the `unpaid` badge. */
export function siteBillingUnpaid(state: string): boolean {
  return state === "past_due" || state === "unpaid";
}
