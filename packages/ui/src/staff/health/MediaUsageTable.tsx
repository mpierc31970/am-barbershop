// MediaUsageTable (13-45 choice 2; CONT-19 staff half, D221, D225; 13-UI-SPEC "Media usage"
// line 902). Site · Images · Video · Audio · Downloads (sizes tabular) · Total vs allowance
// (Label "1.4 GB of 2 GB", no meter) · Delivery this month ("—" titled "Delivery figures
// arrive with Bunny stats" until Bunny stats exist) · `h-warn` "Over allowance" at the
// allowance (2 GB + packs) · **Open site**. Sorted by total, largest first. Server-safe; the
// "Only over allowance" Switch is the app's (URL `?over=1`).
import { Badge } from "../../hub/Badge";
import { formatHealthBytes, HEALTH_COPY } from "./copy";

const C = HEALTH_COPY.media;

export interface MediaUsageRowView {
  orgId: string;
  business: string;
  imageBytes: number;
  videoBytes: number;
  audioBytes: number;
  usedBytes: number;
  allowanceBytes: number;
  /** null until Bunny stats are wired. */
  deliveryBytes: number | null;
  level: "ok" | "warn" | "full";
}

export function mediaOverAllowance(r: MediaUsageRowView): boolean {
  return r.level === "full" || r.usedBytes >= r.allowanceBytes;
}

/** "1.4 GB of 2 GB". */
export function mediaTotalText(r: MediaUsageRowView): string {
  return `${formatHealthBytes(r.usedBytes)} of ${formatHealthBytes(r.allowanceBytes)}`;
}

const TH =
  "px-3 py-2 text-left text-sm font-semibold text-hub-ink-muted whitespace-nowrap";
const THN = `${TH} text-right`;
const TD = "px-3 py-3 align-top text-base";
const TDN = `${TD} text-right tabular-nums whitespace-nowrap`;

export function MediaUsageTable({
  rows,
  siteHref = (orgId) => `/staff/sites/${orgId}?tab=media`,
  showOpen = true,
}: {
  rows: readonly MediaUsageRowView[];
  siteHref?: (orgId: string) => string;
  /** Hide the Open site column (Site › Media shows the one site). */
  showOpen?: boolean;
}) {
  const list = [...rows].sort(
    (a, b) => b.usedBytes - a.usedBytes || a.orgId.localeCompare(b.orgId),
  );
  return (
    <div className="overflow-x-auto rounded border border-hub-border bg-hub-surface">
      <table className="w-full border-collapse font-hub text-hub-ink">
        <caption className="sr-only">{C.caption}</caption>
        <thead className="border-b border-hub-border bg-hub-surface-2">
          <tr>
            <th scope="col" className={TH}>
              {C.cols.site}
            </th>
            <th scope="col" className={`${THN} max-md:hidden`}>
              {C.cols.images}
            </th>
            <th scope="col" className={`${THN} max-md:hidden`}>
              {C.cols.video}
            </th>
            <th scope="col" className={`${THN} max-md:hidden`}>
              {C.cols.audio}
            </th>
            <th scope="col" className={`${THN} max-md:hidden`}>
              {C.cols.downloads}
            </th>
            <th scope="col" className={TH}>
              {C.cols.total}
            </th>
            <th scope="col" className={`${THN} max-md:hidden`}>
              {C.cols.delivery}
            </th>
            {showOpen ? (
              <th scope="col" className={TH}>
                <span className="sr-only">{C.cols.open}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr
              key={r.orgId}
              className="border-b border-hub-border last:border-b-0"
            >
              <th scope="row" className={`${TD} text-left font-semibold`}>
                {r.business || r.orgId}
              </th>
              <td className={`${TDN} max-md:hidden`}>
                {formatHealthBytes(r.imageBytes)}
              </td>
              <td className={`${TDN} max-md:hidden`}>
                {formatHealthBytes(r.videoBytes)}
              </td>
              <td className={`${TDN} max-md:hidden`}>
                {formatHealthBytes(r.audioBytes)}
              </td>
              <td className={`${TDN} max-md:hidden`}>
                <span title={C.downloadsTitle}>{HEALTH_COPY.none}</span>
              </td>
              <td className={TD}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm tabular-nums">
                    {mediaTotalText(r)}
                  </span>
                  {mediaOverAllowance(r) ? (
                    <Badge tone="h-warn">{C.over}</Badge>
                  ) : r.level === "warn" ? (
                    <Badge tone="h-none">{C.near}</Badge>
                  ) : null}
                </span>
              </td>
              <td className={`${TDN} max-md:hidden`}>
                {r.deliveryBytes === null ? (
                  <span title={C.deliveryTitle}>{HEALTH_COPY.none}</span>
                ) : (
                  formatHealthBytes(r.deliveryBytes)
                )}
              </td>
              {showOpen ? (
                <td className={TD}>
                  <a
                    href={siteHref(r.orgId)}
                    aria-label={`${C.openSite}: ${r.business || r.orgId}`}
                    className="rounded text-sm font-semibold whitespace-nowrap underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                  >
                    {C.openSite}
                  </a>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
