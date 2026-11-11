// Panel sites/[org]/indexing: filled by 13-39
// Panel sites/[org]/indexing (13-39 choice 3; STAFF-17, D190; 13-UI-SPEC "Indexing" lines
// 911-915). The Health › Indexing table with this site's one row and Resubmit now (no Resubmit
// all), plus the weekly job's last run. A failed read logs the class name only.
// IndexingTable is a client component: pass no function props (CR-D03). Its default Site
// link is already this site's Indexing tab.
import { staffIndexingStatus, type StaffIndexingRow } from "@cds/db";
import { IndexingTable } from "@cds/ui/staff";
import { resubmitAction } from "../../../../../../actions/staff/indexing";
import {
  indexingRowView,
  lastIndexingRun,
} from "../../../health/panels/indexing";
import type { StaffSitePanelProps } from "../../../StaffAreaPage";
import { SitesLoadError } from "../../SitesLoadError";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export default async function Panel({ session, orgId }: StaffSitePanelProps) {
  let rows: StaffIndexingRow[];
  try {
    rows = await staffIndexingStatus(session.ctx, { orgId });
  } catch (err) {
    console.error("[staff] site indexing read failed", errName(err));
    return <SitesLoadError href={`/staff/sites/${orgId}?tab=indexing`} />;
  }
  return (
    <IndexingTable
      rows={rows.map(indexingRowView)}
      lastRunAt={await lastIndexingRun()}
      resubmit={resubmitAction}
    />
  );
}
