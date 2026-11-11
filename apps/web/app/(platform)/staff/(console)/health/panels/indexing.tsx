// Panel health/indexing: filled by 13-39
// Panel health/indexing (13-39 choices 1 and 2; STAFF-17, D190; 13-UI-SPEC "Indexing" lines
// 911-915). Every live site plus any site with an indexing row (staffIndexingStatus): last
// ping, sitemap, pages indexed ("—" until Search Console), last resubmit, Resubmit now per row
// and Resubmit all live sites (CaseDialog). The schedule line reads the weekly job's heartbeat
// (indexingStatus). A failed read logs the class name only.
import {
  indexingStatus,
  staffIndexingStatus,
  type StaffIndexingRow,
} from "@cds/db";
import { IndexingTable, type IndexingRowView } from "@cds/ui/staff";
import {
  resubmitAction,
  resubmitAllAction,
} from "../../../../../actions/staff/indexing";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";

const HREF = "/staff/health?tab=indexing";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** The table's view of a db row (exported for the site panel and tests). */
export function indexingRowView(r: StaffIndexingRow): IndexingRowView {
  return {
    orgId: r.orgId,
    business: r.business,
    host: r.host,
    live: r.live,
    demo: r.demo,
    lastPingAt: r.lastPingAt,
    lastPingResult: r.lastPingResult,
    sitemapStatus: r.sitemapStatus,
    pagesIndexed: r.pagesIndexed,
    lastResubmitAt: r.lastResubmitAt,
  };
}

/** The weekly job's last run, or null when the heartbeat can't be read (label only). */
export async function lastIndexingRun(): Promise<string | null> {
  try {
    return (await indexingStatus()).last_weekly_resubmit;
  } catch (err) {
    console.error("[staff] indexing heartbeat read failed", errName(err));
    return null;
  }
}

export default async function Panel({ session }: StaffPanelProps) {
  let rows: StaffIndexingRow[];
  try {
    rows = await staffIndexingStatus(session.ctx);
  } catch (err) {
    console.error("[staff] indexing read failed", errName(err));
    return <SitesLoadError href={HREF} />;
  }
  return (
    <IndexingTable
      rows={rows.map(indexingRowView)}
      lastRunAt={await lastIndexingRun()}
      resubmit={resubmitAction}
      resubmitAll={resubmitAllAction}
    />
  );
}
