"use client";
// SitesTable (13-33 choice 2; STAFF-02, D5; 13-UI-SPEC "Sites list" lines 765-773, tone map
// lines 190-221). Every org on one StaffTable: Business (link to /staff/sites/<org>, Demo and
// repeat-infringer badges inline) · Status (s-* tones) · Path · Plan · Add-ons (count, names in
// `title`) · Host (live host link, else "preview") · Created · Last owner activity · Open
// tickets (link to the Inbox filtered to the site). Under 640px rows stack (business, status,
// open tickets). Rows arrive sorted and filtered from the panel (URL params); empty shows
// "No sites match.". Tenant-authored names stay React text.
// 14-45 (LIFE-01; 14-UI-SPEC "Sites list"): a site in its offboarding notice shows the
// `s-leaving` badge "Leaving · 23d" beside its state badge.
import { Badge } from "../../hub/Badge";
import { SiteFlags, SiteStateBadge } from "./badges";
import { useShortcutsEnabled } from "../shell";
import { AgeCell, StaffTable, type StaffColumn } from "../table";
import {
  SITE_STATE_BADGE,
  SITES_COPY as C,
  formatSiteDate,
  sitePathLabel,
  sitePlanLabel,
  type SiteStateView,
} from "./copy";

/** One Sites list row (mirrors @cds/db StaffSiteRow, add-on names resolved by the panel). */
export interface SiteListRow {
  orgId: string;
  name: string;
  state: SiteStateView;
  path: string;
  plan: string;
  carePlan: boolean;
  /** Active add-on display names. */
  addonNames: readonly string[];
  liveHost: string | null;
  previewHost: string | null;
  created: string;
  lastOwnerActivity: string | null;
  openTickets: number;
  demo: boolean;
  repeatInfringer: boolean;
  /** Days left in an open offboarding notice; null/absent when not leaving (14-45). */
  leavingDays?: number | null;
}

/** Sites list words for Leaving CDS (14-45). */
export const SITES_LEAVING_COPY = {
  filter: "Leaving",
  badge: (days: number) => `Leaving · ${days}d`,
  badgeSr: (days: number) =>
    `Leaving CDS, ${days} ${days === 1 ? "day" : "days"} left`,
} as const;

/** The `s-leaving` badge, or nothing when the site is not leaving. */
export function SiteLeavingBadge({
  days,
}: {
  days: number | null | undefined;
}) {
  if (typeof days !== "number") return null;
  return (
    <span title={SITES_LEAVING_COPY.badgeSr(days)}>
      <Badge tone="s-leaving">{SITES_LEAVING_COPY.badge(days)}</Badge>
    </span>
  );
}

export interface SitesTableProps {
  rows: readonly SiteListRow[];
  /** ISO time the page was read (AgeCell reference; keeps server and client in step). */
  now: string;
}

const LINK =
  "rounded text-hub-accent underline-offset-2 hover:underline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function columns(now: Date): StaffColumn<SiteListRow>[] {
  return [
    {
      id: "business",
      header: C.cols.business,
      priority: 1,
      primary: true,
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>{r.name || r.orgId}</span>
          <SiteFlags demo={r.demo} repeatInfringer={r.repeatInfringer} />
        </span>
      ),
    },
    {
      id: "status",
      header: C.cols.status,
      priority: 1,
      stack: true,
      nowrap: true,
      cell: (r) =>
        typeof r.leavingDays === "number" ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <SiteStateBadge state={r.state} />
            <SiteLeavingBadge days={r.leavingDays} />
          </span>
        ) : (
          <SiteStateBadge state={r.state} />
        ),
    },
    {
      id: "path",
      header: C.cols.path,
      priority: 3,
      cell: (r) => sitePathLabel(r.path),
    },
    {
      id: "plan",
      header: C.cols.plan,
      priority: 4,
      cell: (r) => sitePlanLabel(r.plan, r.carePlan),
    },
    {
      id: "addons",
      header: C.cols.addons,
      priority: 3,
      align: "end",
      cell: (r) => (
        <span
          title={r.addonNames.length > 0 ? r.addonNames.join(", ") : undefined}
          className="tabular-nums"
        >
          {r.addonNames.length}
        </span>
      ),
    },
    {
      id: "host",
      header: C.cols.host,
      priority: 2,
      cell: (r) =>
        r.liveHost ? (
          <a
            href={`https://${r.liveHost}`}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK}
          >
            {r.liveHost}
          </a>
        ) : (
          <span className="text-hub-ink-muted">{C.preview}</span>
        ),
    },
    {
      id: "created",
      header: C.cols.created,
      priority: 4,
      nowrap: true,
      cell: (r) => formatSiteDate(r.created),
    },
    {
      id: "lastOwner",
      header: C.cols.lastOwner,
      priority: 4,
      nowrap: true,
      cell: (r) => <AgeCell from={r.lastOwnerActivity ?? ""} now={now} />,
    },
    {
      id: "openTickets",
      header: C.cols.openTickets,
      priority: 2,
      stack: true,
      align: "end",
      cell: (r) =>
        r.openTickets > 0 ? (
          <a
            href={`/staff/tickets?org=${encodeURIComponent(r.orgId)}`}
            aria-label={`${C.openTicketsLink(r.openTickets)}, ${r.name}`}
            className={`${LINK} tabular-nums`}
          >
            {r.openTickets}
          </a>
        ) : (
          <span className="tabular-nums text-hub-ink-muted">0</span>
        ),
    },
  ];
}

export function SitesTable({ rows, now }: SitesTableProps) {
  const [shortcuts] = useShortcutsEnabled();
  if (rows.length === 0) {
    return (
      <p className="py-6 font-hub text-base text-hub-ink-muted">{C.empty}</p>
    );
  }
  const at = new Date(now);
  return (
    <StaffTable
      caption={C.caption}
      columns={columns(Number.isNaN(at.getTime()) ? new Date() : at)}
      rows={rows}
      rowKey={(r) => r.orgId}
      rowLabel={(r) => r.name || r.orgId}
      rowAnnouncement={(r) =>
        `${r.name || r.orgId}, ${SITE_STATE_BADGE[r.state].label}` +
        (typeof r.leavingDays === "number"
          ? `, ${SITES_LEAVING_COPY.badgeSr(r.leavingDays)}`
          : "")
      }
      primaryHref={(r) => `/staff/sites/${encodeURIComponent(r.orgId)}`}
      shortcutsEnabled={shortcuts}
    />
  );
}
