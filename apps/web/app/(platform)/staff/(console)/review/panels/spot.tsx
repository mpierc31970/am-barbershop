// Panel review/spot: filled by 13-38
// Panel review/spot (13-38 choice 2; STAFF-23; D248; 13-UI-SPEC "Spot checks"). `?view=open|done`
// over listReviewQueue({ tab: "spot" }): Case · Site · Why picked · Pages (marked/total) ·
// Opened. Pages are marked OK / Issue on the case page (UI-SPEC "Case page" spot checks).
import { listReviewQueue, type ReviewQueueItem } from "@cds/db";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { SpotList } from "../ReviewLists";
import { errName, listView, spotRow } from "../review-data";

export default async function Panel({ session, params }: StaffPanelProps) {
  const view = listView(params.view);
  const href =
    view === "open"
      ? "/staff/review?tab=spot"
      : "/staff/review?tab=spot&view=done";
  let items: ReviewQueueItem[];
  try {
    items = await listReviewQueue(session.ctx, { tab: "spot", status: view });
  } catch (err) {
    console.error("[staff] review spot read failed", errName(err));
    return <SitesLoadError href={href} />;
  }
  return (
    <SpotList
      rows={items.map(spotRow)}
      view={view}
      now={new Date().toISOString()}
    />
  );
}
