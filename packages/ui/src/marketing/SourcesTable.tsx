// Owner: 15-12 (P15-P1). SourcesTable: every claim shown on the page with competitor, figure, source and
// checked date (15-UI-SPEC "Pricing" section 9, components table; HUB-06, A2-Q3). Marigold band (fine print
// printed loud). Input is the page's visibleClaims() list, so production lists verified claims only.
import { ExternalLink } from "lucide-react";
import { MK_COPY, formatCheckedDate, type Claim } from "@cds/core/marketing";
import { DraftBadge, shownClaims } from "./DraftBadge";

export type SourcesTableProps = {
  claims: readonly Claim[];
  /** Dev only (`!isProductionHub()`): DraftBadge beside draft rows. */
  showDrafts?: boolean;
  className?: string;
};

const TH =
  "border-b border-mk-ink px-3 py-2 text-left text-[14px] leading-[1.4] font-bold";
const TD =
  "border-b border-mk-ink/30 px-3 py-3 align-top text-[14px] leading-[1.4]";

export function SourcesTable({
  claims: given,
  showDrafts = false,
  className,
}: SourcesTableProps) {
  // Drafts are dropped here too when hidden (WR-C05).
  const claims = shownClaims(given, showDrafts);
  if (claims.length === 0) return null;
  const S = MK_COPY.SOURCES;
  return (
    <div
      data-mk-field="marigold"
      className={["bg-mk-field-bg px-6 py-8 text-mk-fg", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="mx-auto flex max-w-[1040px] flex-col gap-4">
        <h2
          id="sources-title"
          className="m-0 font-mk-display text-[32px] leading-[1.05] font-bold text-mk-ink"
        >
          {S.H2}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-mk-ink">
            <caption className="sr-only">{S.CAPTION}</caption>
            <thead>
              <tr>
                {S.COLUMNS.map((c) => (
                  <th key={c} scope="col" className={TH}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <th scope="row" className={`${TD} text-left font-bold`}>
                    {c.competitor}
                    {c.status === "draft" ? (
                      <DraftBadge show={showDrafts} className="ml-2" />
                    ) : null}
                  </th>
                  <td className={`${TD} mk-figures`}>{c.figure}</td>
                  <td className={TD}>
                    <a
                      href={c.sourceUrl}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 py-1 text-mk-ink underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
                    >
                      {c.sourceTitle}
                      <span className="sr-only"> {MK_COPY.COMMON.NEW_TAB}</span>
                      <ExternalLink size={16} aria-hidden="true" />
                    </a>
                  </td>
                  <td className={`${TD} mk-figures whitespace-nowrap`}>
                    <time dateTime={c.verifiedOn}>
                      {formatCheckedDate(c.verifiedOn)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
