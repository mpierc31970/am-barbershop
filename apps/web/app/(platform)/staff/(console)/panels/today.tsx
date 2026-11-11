// Panel today/today (13-47 choice 3; STAFF-20, STAFF-26, D-UI-P13-5, D-UI-P13-20; 13-UI-SPEC
// "Today"). The status line under the H1 ("14 live · 3 building · 9 open tickets · Jobs OK"),
// then the ranked needs-attention CountRows, or TODAY-EMPTY. Counts come from staffTodayCounts
// through loadStaffToday (one read per request, shared with the sidebar badges). A source that
// failed shows "Couldn't count" on its row; a failed read overall shows ERR-LOAD. The client
// island re-fetches every 60 s while visible and on window focus (router.refresh()).
import { todayAgeDays, type StaffTodayCounts } from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import {
  CountRowList,
  TodayStatusLine,
  type TodayRowView,
} from "@cds/ui/staff";
import Link from "next/link";
import { loadStaffToday } from "../../../../../lib/staff-today";
import type { StaffPanelProps } from "../StaffAreaPage";
import { TodayIsland } from "../TodayIsland";

/** The read model's rows as plain views for the server-safe CountRow list. */
export function todayRowViews(rows: StaffTodayCounts["rows"]): TodayRowView[] {
  return rows.map((r) => ({
    id: r.id,
    count: r.count,
    severity: r.severity,
    label: r.label,
    href: r.href,
    oldestDays: todayAgeDays(r.oldestMs),
  }));
}

export default async function Panel({ session }: StaffPanelProps) {
  let counts: StaffTodayCounts;
  try {
    counts = await loadStaffToday(session);
  } catch (err) {
    console.error(
      "[staff today] load failed",
      err instanceof Error ? err.name : typeof err,
    );
    return (
      <div className="flex flex-col gap-4">
        <InlineAlert tone="error">{SUPPORT_UI_COPY.ERR_LOAD}</InlineAlert>
        <TodayIsland attention={0} />
      </div>
    );
  }
  const rows = todayRowViews(counts.rows);
  const attention = rows.filter((r) => r.count !== null).length;
  return (
    <div className="-mt-4 flex flex-col gap-8">
      <TodayStatusLine status={counts.status} LinkComponent={Link} />
      <CountRowList rows={rows} LinkComponent={Link} />
      <TodayIsland attention={attention} />
    </div>
  );
}
