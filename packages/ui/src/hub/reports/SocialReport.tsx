// SocialReport (11-33; DASH-15, D199; 11-UI-SPEC "Social tab"). Visits and messages (form
// submissions) per social platform from first-party stats. A sentence names the top source;
// the table lists every platform (brand icon aria-hidden + visible name). No follower counts,
// ever (D199). No visits: SOCIAL-EMPTY + "Add your bio links" -> Marketing › Social.
// Server-renders as a client-free tree except MetricTable's Show all.
import type { HubLinkComponent } from "../AddonCard";
import { BrandIcon } from "../../site/icons/BrandIcon";
import { MetricTable } from "./MetricTable";
import {
  REPORTS_COPY,
  formatCount,
  plural,
  sourceIcon,
  sourceLabel,
  type ReportPeriod,
} from "./copy";

export interface SocialReportRow {
  source: string;
  visits: number;
  /** Form submissions attributed to this source. */
  conversions: number;
}

export interface SocialReportProps {
  rows: readonly SocialReportRow[];
  period: ReportPeriod;
  /** Marketing › Social (bio links). */
  addLinksHref: string;
  LinkComponent?: HubLinkComponent;
}

export function SocialReport({
  rows,
  period,
  addLinksHref,
  LinkComponent,
}: SocialReportProps) {
  const Link = LinkComponent ?? "a";
  const top = rows[0];
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      {top && top.visits + top.conversions > 0 ? (
        <p className="max-w-[68ch] text-base">
          <strong className="font-semibold">{sourceLabel(top.source)}</strong>{" "}
          sent{" "}
          <strong className="font-semibold">
            {plural(top.visits, "visitor", "visitors")}
          </strong>{" "}
          and{" "}
          <strong className="font-semibold">
            {plural(top.conversions, "message", "messages")}
          </strong>{" "}
          in the last {period} days.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-base text-hub-ink-muted">
          {REPORTS_COPY.socialEmpty}{" "}
          <Link
            href={addLinksHref}
            className="text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover"
          >
            {REPORTS_COPY.socialEmptyLink}
          </Link>
        </p>
      ) : (
        <MetricTable
          caption="Visits and messages by social account"
          columns={[
            { key: "account", label: "Account" },
            { key: "visits", label: "Visitors", numeric: true },
            { key: "messages", label: "Messages", numeric: true },
          ]}
          rows={rows.map((r) => {
            const icon = sourceIcon(r.source);
            return {
              key: r.source,
              cells: {
                account: (
                  <span className="inline-flex items-center gap-2">
                    {icon ? <BrandIcon id={icon} size={16} /> : null}
                    {sourceLabel(r.source)}
                  </span>
                ),
                visits: formatCount(r.visits),
                messages: formatCount(r.conversions),
              },
            };
          })}
        />
      )}
      <p className="text-sm text-hub-ink-muted">
        {REPORTS_COPY.socialFootnote}
      </p>
    </div>
  );
}
