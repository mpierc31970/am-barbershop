// Panel review/reports: filled by 13-38
// Panel review/reports (13-38 choice 2; STAFF-24, STAFF-26; D249, D292, P13-P25, D-UI-P13-25;
// 13-UI-SPEC "Reports & DMCA"). `?view=open|done` (Open · Closed) over listReviewQueue({ tab:
// "reports" }) joined with repeatInfringerFor (flag only, no close-site button). Log a report
// opens the drawer (a case, never a ticket).
import {
  listReviewQueue,
  repeatInfringerFor,
  type ReviewQueueItem,
} from "@cds/db";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { ReportsList } from "../ReviewLists";
import { errName, listView, reportRow } from "../review-data";

export default async function Panel({ session, params }: StaffPanelProps) {
  const view = listView(params.view);
  const href =
    view === "open"
      ? "/staff/review?tab=reports"
      : "/staff/review?tab=reports&view=done";
  let items: ReviewQueueItem[];
  let repeat: Set<string>;
  try {
    items = await listReviewQueue(session.ctx, {
      tab: "reports",
      status: view,
    });
    repeat = await repeatInfringerFor(
      items.map((i) => i.orgId).filter((o): o is string => Boolean(o)),
    );
  } catch (err) {
    console.error("[staff] review reports read failed", errName(err));
    return <SitesLoadError href={href} />;
  }
  const me = session.ctx.actor;
  return (
    <ReportsList
      rows={items.map((i) => reportRow(i, me, repeat))}
      view={view}
    />
  );
}
