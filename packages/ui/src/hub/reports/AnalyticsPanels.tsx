// GA4 and Search Console panels (11-33; DASH-10, DASH-11, D59, D189, D196; 11-UI-SPEC
// "Reports" sections 9 and 10). Not connected (stand-in or no property yet) renders
// NotConnectedNote: never an error, never a connect button (CDS sets it up). Connected GA4
// shows Visitors, Sessions and its top pages, plus GA4-NOTE (the one-line undercount note).
// Types only from @cds/core.
import type {
  Ga4Summary,
  NotConnected,
  SearchQueries,
} from "@cds/core/analytics";
import { MetricTable } from "./MetricTable";
import { NotConnectedNote } from "./ReportSection";
import { REPORTS_COPY, formatCount } from "./copy";

export function Ga4Panel({ summary }: { summary: Ga4Summary | NotConnected }) {
  if (!summary.connected) return <NotConnectedNote />;
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      <dl className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-hub-ink-muted">Visitors</dt>
          <dd className="text-base font-semibold tabular-nums">
            {formatCount(summary.users)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-hub-ink-muted">Visits</dt>
          <dd className="text-base font-semibold tabular-nums">
            {formatCount(summary.sessions)}
          </dd>
        </div>
      </dl>
      <MetricTable
        caption="Google Analytics top pages"
        columns={[
          { key: "page", label: "Page" },
          { key: "views", label: "Views", numeric: true },
        ]}
        rows={summary.topPages.map((p) => ({
          key: p.path,
          cells: { page: p.path, views: formatCount(p.views) },
        }))}
      />
      <p className="text-sm text-hub-ink-muted">{REPORTS_COPY.ga4Note}</p>
    </div>
  );
}

export function SearchQueriesPanel({
  queries,
}: {
  queries: SearchQueries | NotConnected;
}) {
  if (!queries.connected) return <NotConnectedNote />;
  return (
    <MetricTable
      caption="Google searches that showed your site"
      columns={[
        { key: "query", label: "Search" },
        { key: "shown", label: "Times shown", numeric: true },
        { key: "clicks", label: "Clicks", numeric: true },
      ]}
      rows={queries.rows.map((r, i) => ({
        key: `${i}-${r.query}`,
        cells: {
          query: r.query,
          shown: formatCount(r.impressions),
          clicks: formatCount(r.clicks),
        },
      }))}
      empty={REPORTS_COPY.searchesNone}
    />
  );
}
