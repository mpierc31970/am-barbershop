// Panel health/media: filled by 13-45
// Panel health/media (13-45 choice 2; CONT-19 staff half, D221, D225; 13-UI-SPEC "Media
// usage" lines 902-905). Per-site storage from listMediaUsage (the `media:usage` CLI's call;
// feature `media_usage`, both roles) mapped by staffMediaUsageRowView (media-usage-view.ts):
// Images, Video, Audio, Downloads, Total vs the org's allowance (2 GB + packs), Delivery this
// month ("—" until Bunny stats), the over-allowance badge and Open site. `?over=1` ("Only over
// allowance") keeps only sites at or past their allowance. A failed read shows ERR-LOAD.
import { listMediaUsage, type MediaUsageRow } from "@cds/db";
import {
  HEALTH_COPY,
  MediaUsageTable,
  formatHealthBytes,
  mediaOverAllowance,
} from "@cds/ui/staff";
import { staffMediaUsageRowView } from "../../../../../../lib/media-usage-view";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { errName } from "../health-data";
import { MediaOverSwitch, mediaTabHref } from "../HealthIslands";

const C = HEALTH_COPY.media;

export default async function Panel({ session, params }: StaffPanelProps) {
  const over = params.over === "1";
  let raw: MediaUsageRow[];
  try {
    raw = await listMediaUsage(session.ctx, over ? { over: true } : {});
  } catch (err) {
    console.error("[staff] media usage read failed", errName(err));
    return <SitesLoadError href={mediaTabHref(over)} />;
  }
  const all = raw.map(staffMediaUsageRowView);
  const rows = over ? all.filter(mediaOverAllowance) : all;
  const stored = rows.reduce((n, r) => n + r.usedBytes, 0);
  const overCount = rows.filter(mediaOverAllowance).length;
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-hub-ink-muted tabular-nums">
          {C.summary(rows.length, formatHealthBytes(stored), overCount)}
        </p>
        <div className="ml-auto">
          <MediaOverSwitch over={over} />
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">
          {over ? C.emptyOver : C.empty}
        </p>
      ) : (
        <MediaUsageTable rows={rows} />
      )}
    </div>
  );
}
