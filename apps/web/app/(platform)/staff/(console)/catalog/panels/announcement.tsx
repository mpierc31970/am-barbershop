// Panel catalog/announcement: filled by 13-37
// Panel catalog/announcement (13-37 choice 4; STAFF-07, DASH-23; 13-UI-SPEC "Announcement" lines
// 867-872). The announcement showing now on any path (staffCurrentAnnouncement), as owners see
// it in From CDS on Today, with its paths and end; then the announce:set form for Super
// Admins (step-up in the actions). Agents read only. Empty: "No announcement is showing." A
// failed read logs the class name only.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { staffCurrentAnnouncement, type StaffAnnouncementView } from "@cds/db";
import { CATALOG_COPY as C } from "@cds/ui/staff";
import { staffCan } from "../../../../../../lib/staff-session";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { AnnouncementIsland, type AnnouncementView } from "../CatalogIsland";

const HREF = "/staff/catalog?tab=announcement";
const PATH_LABELS = {
  standard: "Standard",
  studio: "Studio",
  shop: "Shop",
} as const;

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: BUSINESS_TIME_ZONE,
});

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** The island's view (exported for tests). */
export function announcementView(a: StaffAnnouncementView): AnnouncementView {
  const end = a.endsAt ? Date.parse(a.endsAt.replace(" ", "T")) : NaN;
  return {
    title: a.title,
    body: a.body,
    href: a.href,
    paths: a.paths,
    endsAt: Number.isNaN(end) ? null : new Date(end).toISOString(),
    untilText: Number.isNaN(end)
      ? C.annOpenEnded
      : C.annUntil(DAY.format(new Date(end))),
    pathsText:
      a.paths.length === 0
        ? C.annEveryPath
        : a.paths.map((p) => PATH_LABELS[p]).join(", "),
  };
}

export default async function Panel({ session }: StaffPanelProps) {
  let current: StaffAnnouncementView | null;
  try {
    current = await staffCurrentAnnouncement(session.ctx);
  } catch (err) {
    console.error("[staff] announcement read failed", errName(err));
    return <SitesLoadError href={HREF} />;
  }
  return (
    <AnnouncementIsland
      current={current ? announcementView(current) : null}
      canEdit={staffCan(session.role, "announce_set")}
    />
  );
}
