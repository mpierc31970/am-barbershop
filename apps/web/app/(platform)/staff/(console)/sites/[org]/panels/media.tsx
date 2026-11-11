// Panel sites/[org]/media: filled by 13-45
// Panel sites/[org]/media (13-45 choice 2; CONT-19 staff half, D221, D225, D249). The Health ›
// Media usage table with this one site's row (listMediaUsage scoped by orgId; feature
// `media_usage`, both roles), no Open site column, plus the media takedown CLI line and its
// how-to. A site with no media says so. A failed read shows ERR-LOAD.
import { listMediaUsage, type MediaUsageRow } from "@cds/db";
import { HEALTH_COPY, MediaUsageTable } from "@cds/ui/staff";
import { staffMediaUsageRowView } from "../../../../../../../lib/media-usage-view";
import type { StaffSitePanelProps } from "../../../StaffAreaPage";
import { SitesLoadError } from "../../SitesLoadError";

const C = HEALTH_COPY.media;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export default async function Panel({ session, orgId }: StaffSitePanelProps) {
  let raw: MediaUsageRow[];
  try {
    raw = await listMediaUsage(session.ctx, { orgId });
  } catch (err) {
    console.error("[staff] site media usage read failed", errName(err));
    return <SitesLoadError href={`/staff/sites/${orgId}?tab=media`} />;
  }
  const rows = raw.map(staffMediaUsageRowView);
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">{C.siteEmpty}</p>
      ) : (
        <MediaUsageTable rows={rows} showOpen={false} />
      )}
      <p className="text-sm text-hub-ink-muted">
        <code>{C.takedown}</code>
      </p>
    </div>
  );
}
