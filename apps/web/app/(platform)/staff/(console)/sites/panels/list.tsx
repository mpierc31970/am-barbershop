// Panel sites/list: filled by 13-33
// Panel sites/list (13-33 choice 2; STAFF-02, STAFF-05, D5; 13-UI-SPEC "Sites list" lines
// 765-773). One `staffListSites` read, filters as URL params (a filtered view is a link):
// q (name, slug, host) · status (a site state, "demo", or "leaving": an offboarding notice is
// open, 14-45) · path · addon · open=1 (has open tickets) · page. Default order: status group (suspended, notice, held, building, review,
// live, others) then name; 50 per page. Add-on slugs become names through ADDON_REGISTRY
// (private ones included: staff see everything). A failed read logs the class name only and
// shows ERR-LOAD.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import {
  STAFF_SITE_STATES,
  staffListSites,
  type StaffSiteRow,
  type StaffSiteState,
  type StaffSitesFilter,
} from "@cds/db";
import { FilterBar, type FilterField } from "@cds/ui/staff";
import {
  SITE_STATE_BADGE,
  SITE_STATE_GROUP,
  SITES_COPY,
  sitePathLabel,
  SitesTable,
  type SiteListRow,
} from "@cds/ui/staff";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../SitesLoadError";

export const SITES_PAGE_SIZE = 50;
const Q_MAX = 120;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type SitesListParams = {
  q: string;
  status: StaffSiteState | "demo" | "leaving" | "";
  path: AddonPath | "";
  addon: string;
  open: boolean;
  page: number;
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Untrusted URL params → a closed filter (unknown values read as Any). */
export function parseSitesParams(
  params: StaffPanelProps["params"],
): SitesListParams {
  const q = one(params.q).trim().slice(0, Q_MAX);
  const rawStatus = one(params.status);
  const status =
    rawStatus === "demo" ||
    rawStatus === "leaving" ||
    (STAFF_SITE_STATES as readonly string[]).includes(rawStatus)
      ? (rawStatus as SitesListParams["status"])
      : "";
  const rawPath = one(params.path);
  const path = (ADDON_PATHS as readonly string[]).includes(rawPath)
    ? (rawPath as AddonPath)
    : "";
  const rawAddon = one(params.addon);
  const addon =
    SLUG_RE.test(rawAddon) && ADDON_REGISTRY.get(rawAddon) ? rawAddon : "";
  const open = one(params.open) === "1";
  const n = Number.parseInt(one(params.page), 10);
  const page = Number.isFinite(n) && n >= 1 && n <= 1000 ? n : 1;
  return { q, status, path, addon, open, page };
}

function addonName(slug: string): string {
  return ADDON_REGISTRY.get(slug)?.name ?? slug;
}

/** Status group, then name (UI-SPEC default sort). */
export function sortSites<T extends Pick<StaffSiteRow, "state" | "name">>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      SITE_STATE_GROUP[a.state] - SITE_STATE_GROUP[b.state] ||
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
}

function toView(r: StaffSiteRow): SiteListRow {
  return {
    orgId: r.orgId,
    name: r.name,
    state: r.state,
    path: r.path,
    plan: r.plan,
    carePlan: r.carePlan,
    addonNames: r.addons.map(addonName),
    liveHost: r.liveHost,
    previewHost: r.previewHost,
    created: r.created,
    lastOwnerActivity: r.lastOwnerActivity,
    openTickets: r.openTickets,
    demo: r.demo,
    repeatInfringer: r.repeatInfringer,
    leavingDays: r.leavingDays,
  };
}

function pageHref(p: SitesListParams, page: number): string {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.status) qs.set("status", p.status);
  if (p.path) qs.set("path", p.path);
  if (p.addon) qs.set("addon", p.addon);
  if (p.open) qs.set("open", "1");
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/staff/sites?${s}` : "/staff/sites";
}

const PAGER =
  "inline-flex h-8 items-center rounded px-3 font-hub text-sm font-semibold text-hub-ink " +
  "hover:bg-hub-surface-2 pointer-coarse:min-h-11 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export default async function Panel({ session, params }: StaffPanelProps) {
  const p = parseSitesParams(params);
  const filters: FilterField[] = [
    {
      name: "status",
      label: "Status",
      value: p.status,
      options: [
        ...(Object.keys(SITE_STATE_BADGE) as StaffSiteState[]).map((s) => ({
          value: s,
          label: SITE_STATE_BADGE[s].label,
        })),
        { value: "leaving", label: "Leaving" },
        { value: "demo", label: SITES_COPY.demo },
      ],
    },
    {
      name: "path",
      label: "Path",
      value: p.path,
      options: ADDON_PATHS.map((x) => ({ value: x, label: sitePathLabel(x) })),
    },
    {
      name: "addon",
      label: "Add-on",
      value: p.addon,
      options: ADDON_REGISTRY.list().map((m) => ({
        value: m.slug,
        label: m.name,
      })),
    },
    {
      name: "open",
      label: "Open tickets",
      value: p.open ? "1" : "",
      options: [{ value: "1", label: "Has open tickets" }],
    },
  ];

  let rows: StaffSiteRow[];
  const now = new Date();
  try {
    const filter: StaffSitesFilter = { now };
    if (p.q) filter.q = p.q;
    if (p.status && p.status !== "demo") filter.status = p.status;
    if (p.path) filter.path = p.path;
    if (p.addon) filter.addon = p.addon;
    rows = await staffListSites(session.ctx, filter);
  } catch (err) {
    console.error(
      "[staff] sites list failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href={pageHref(p, p.page)} />;
  }
  const filtered = sortSites(
    rows.filter(
      (r) => (p.status !== "demo" || r.demo) && (!p.open || r.openTickets > 0),
    ),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / SITES_PAGE_SIZE));
  const page = Math.min(p.page, totalPages);
  const shown = filtered
    .slice((page - 1) * SITES_PAGE_SIZE, page * SITES_PAGE_SIZE)
    .map(toView);

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        action="/staff/sites"
        filters={filters}
        search={{
          name: "q",
          label: "Search",
          value: p.q,
          helper: "Business name, host or org id",
        }}
        resultLine={SITES_COPY.resultLine(filtered.length)}
      />
      <SitesTable rows={shown} now={now.toISOString()} />
      {totalPages > 1 ? (
        <nav
          aria-label={`Page ${page} of ${totalPages}`}
          className="flex items-center gap-2 text-sm text-hub-ink-muted"
        >
          {page > 1 ? (
            <a href={pageHref(p, page - 1)} className={PAGER}>
              Previous
            </a>
          ) : null}
          <span className="tabular-nums">{`Page ${page} of ${totalPages}`}</span>
          {page < totalPages ? (
            <a href={pageHref(p, page + 1)} className={PAGER}>
              Next
            </a>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
