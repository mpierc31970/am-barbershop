"use client";
// SiteAuditTable (13-33 choice 3; STAFF-02, Invariant 10; 13-UI-SPEC site detail "Audit"
// lines 798-799). Read-only: Time · Actor ("CDS · Lee" for console and impersonation rows,
// otherwise the member's name) · Action · Target, newest first, 50 per page. The filter
// (All · CDS actions · Impersonation) and the pager are links, so a filtered page is a URL.
import { StaffTable, type StaffColumn } from "../table";
import { SITES_COPY as C, formatSiteDateTime } from "./copy";

export type SiteAuditFilter = "all" | "cds" | "impersonation";

export interface SiteAuditRowView {
  id: string;
  when: string;
  actor: string;
  action: string;
  target: string;
}

export interface SiteAuditTableProps {
  rows: readonly SiteAuditRowView[];
  who: SiteAuditFilter;
  page: number;
  totalPages: number;
  /** Href for a filter + page (built by the panel with URLSearchParams). */
  hrefFor: { [K in SiteAuditFilter]: string };
  newerHref: string | null;
  olderHref: string | null;
}

const LINK =
  "inline-flex h-8 items-center rounded px-3 font-hub text-sm font-semibold " +
  "pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-hub-accent";

const FILTERS: readonly SiteAuditFilter[] = ["all", "cds", "impersonation"];

export function SiteAuditTable({
  rows,
  who,
  page,
  totalPages,
  hrefFor,
  newerHref,
  olderHref,
}: SiteAuditTableProps) {
  const A = C.audit;
  const columns: StaffColumn<SiteAuditRowView>[] = [
    {
      id: "time",
      header: A.cols.time,
      priority: 1,
      stack: true,
      nowrap: true,
      cell: (r) => (
        <span className="tabular-nums text-hub-ink-muted">
          {formatSiteDateTime(r.when)}
        </span>
      ),
    },
    {
      id: "actor",
      header: A.cols.actor,
      priority: 1,
      stack: true,
      cell: (r) => <span className="font-semibold">{r.actor}</span>,
    },
    {
      id: "action",
      header: A.cols.action,
      priority: 1,
      stack: true,
      cell: (r) => <code className="font-mono text-sm">{r.action}</code>,
    },
    {
      id: "target",
      header: A.cols.target,
      priority: 3,
      cell: (r) => r.target || C.none,
    },
  ];
  return (
    <div className="flex flex-col gap-3 font-hub">
      <nav
        aria-label={A.filterLabel}
        className="flex w-fit flex-wrap items-center gap-1 rounded-lg bg-hub-surface-2 p-1"
      >
        {FILTERS.map((f) => (
          <a
            key={f}
            href={hrefFor[f]}
            aria-current={f === who ? "page" : undefined}
            className={
              LINK +
              (f === who
                ? " bg-hub-surface text-hub-ink shadow-sm"
                : " text-hub-ink-muted hover:text-hub-ink")
            }
          >
            {A.filters[f]}
          </a>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">{A.empty}</p>
      ) : (
        <StaffTable
          caption={A.caption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.action}
          primaryHref={() => "#"}
          shortcutsEnabled={false}
        />
      )}
      {totalPages > 1 ? (
        <nav
          aria-label={A.page(page, totalPages)}
          className="flex items-center gap-2 text-sm text-hub-ink-muted"
        >
          {newerHref ? (
            <a href={newerHref} className={`${LINK} text-hub-ink`}>
              {A.newer}
            </a>
          ) : null}
          <span className="tabular-nums">{A.page(page, totalPages)}</span>
          {olderHref ? (
            <a href={olderHref} className={`${LINK} text-hub-ink`}>
              {A.older}
            </a>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
