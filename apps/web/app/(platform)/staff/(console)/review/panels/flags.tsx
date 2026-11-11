// Panel review/flags: filled by 13-38
// Panel review/flags (13-38 choice 2; STAFF-23, STAFF-26; D248, D292, P13-P10; 13-UI-SPEC
// "Flags & holds"). `?view=open|done` over listReviewQueue({ tab: "flags" }): held items first
// (past the 2-business-day promise on top, r-held-late), then flags, then queued scans, in the
// read model's order. Fit holds are counted in one read-only link row to Pipeline › Fit holds.
// A failed read logs the class name only.
import { listReviewQueue, type ReviewQueueItem } from "@cds/db";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { FlagsList } from "../ReviewLists";
import { errName, flagRow, listView } from "../review-data";

export default async function Panel({ session, params }: StaffPanelProps) {
  const view = listView(params.view);
  const href =
    view === "open"
      ? "/staff/review?tab=flags"
      : "/staff/review?tab=flags&view=done";
  let items: ReviewQueueItem[];
  try {
    items = await listReviewQueue(session.ctx, { tab: "flags", status: view });
  } catch (err) {
    console.error("[staff] review flags read failed", errName(err));
    return <SitesLoadError href={href} />;
  }
  const me = session.ctx.actor;
  const fitHolds = items.filter((i) => i.kind === "fit_hold").length;
  const rows = items
    .filter((i) => i.kind !== "fit_hold" && !i.readOnly)
    .map((i) => flagRow(i, me));
  return (
    <FlagsList
      rows={rows}
      fitHolds={fitHolds}
      view={view}
      now={new Date().toISOString()}
    />
  );
}
