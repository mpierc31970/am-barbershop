// Owner: 15-12 (P15-P1). ComparisonTable: "How they make their money, and how we don't"
// (15-UI-SPEC "Comparison"; HUB-06, D182, D296, A2-Q4). Inputs are props: `claims` is already
// visibleClaims(CLAIMS, production) and `showDrafts = !production`. A row with no claim hides; no rows
// renders nothing (the calculator then hides too). Every Elsewhere claim carries a footnote ref; the
// gateway sentence sits once under the table (never imply processing is free).
// footnoteOrder() is the one numbering rule for the page (first appearance: table rows, then the
// gateway sentence, then any claim only the calculator shows), shared with ClaimFootnotes and the calculator.
import { MK_COPY, type Claim, type ClaimRow } from "@cds/core/marketing";
import { DraftBadge, shownClaims, shownOrder } from "./DraftBadge";
import { FootnoteRef } from "./ClaimFootnotes";

/** The four table rows, in page order (the gateway claim is the sentence under the table). */
export const COMPARISON_ROWS = [
  "processing",
  "marketplace",
  "stack",
  "contracts",
] as const satisfies readonly ClaimRow[];

export type ComparisonRowKey = (typeof COMPARISON_ROWS)[number];

/** The claim id the gateway sentence cites. */
export const GATEWAY_CLAIM_ID = "stripe-online";

/**
 * Claims shown in each table row, rows with none dropped. A row shows its summary claims (no `rate`);
 * rate-only claims (the calculator's Mindbody/Boulevard rates) stand in only when no summary is visible.
 */
export function comparisonRows(
  claims: readonly Claim[],
): { row: ComparisonRowKey; claims: Claim[] }[] {
  return COMPARISON_ROWS.flatMap((row) => {
    const all = claims.filter((c) => c.row === row);
    const summary = all.filter((c) => c.rate === undefined);
    const shown = summary.length > 0 ? summary : all;
    return shown.length > 0 ? [{ row, claims: shown }] : [];
  });
}

/** Ids that get their `ref-<id>` anchor in the comparison section (table claims + the gateway claim). */
export function comparisonAnchors(claims: readonly Claim[]): Set<string> {
  const rows = comparisonRows(claims);
  const ids = new Set(rows.flatMap((r) => r.claims.map((c) => c.id)));
  if (rows.length > 0 && claims.some((c) => c.id === GATEWAY_CLAIM_ID))
    ids.add(GATEWAY_CLAIM_ID);
  return ids;
}

/** Footnote order for the page, by first appearance (table rows, gateway sentence, then the rest). */
export function footnoteOrder(claims: readonly Claim[]): string[] {
  const first = [...comparisonAnchors(claims)];
  const seen = new Set(first);
  return [...first, ...claims.map((c) => c.id).filter((id) => !seen.has(id))];
}

export type ComparisonTableProps = {
  claims: readonly Claim[];
  showDrafts: boolean;
  /** Defaults to footnoteOrder(claims); pass the page's order when it renders more claims. */
  order?: readonly string[];
  className?: string;
};

const HEADING_ID = "comparison-title";
const CELL = "px-4 py-4 align-top text-[18px] leading-[1.55] text-mk-ink";
const MOBILE_LABEL = "mb-2 block text-[14px] leading-[1.4] font-bold md:hidden";

/** The gateway sentence with its Stripe footnote (marigold band, Body 700). */
export function GatewayBand({
  claims,
  order,
  anchor,
  className,
}: {
  claims: readonly Claim[];
  order: readonly string[];
  anchor: boolean;
  className?: string;
}) {
  const cited = claims.some((c) => c.id === GATEWAY_CLAIM_ID);
  return (
    <p
      data-mk-field="marigold"
      className={[
        "m-0 bg-mk-field-bg px-4 py-3 text-[18px] leading-[1.55] font-bold text-mk-fg",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {MK_COPY.COMPARISON.GATEWAY}
      {cited ? (
        <FootnoteRef claimId={GATEWAY_CLAIM_ID} order={order} anchor={anchor} />
      ) : null}
    </p>
  );
}

export function ComparisonTable({
  claims: given,
  showDrafts,
  order,
  className,
}: ComparisonTableProps) {
  // Drafts are dropped here too when hidden (WR-C05), before rows and numbering.
  const claims = shownClaims(given, showDrafts);
  const rows = comparisonRows(claims);
  if (rows.length === 0) return null;
  const refs = order
    ? shownOrder(order, given, showDrafts)
    : footnoteOrder(claims);
  const C = MK_COPY.COMPARISON;
  const hasDraft = rows.some((r) => r.claims.some((c) => c.status === "draft"));
  return (
    <div
      className={["mx-auto flex max-w-[1040px] flex-col gap-6", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {showDrafts && hasDraft ? (
        <p
          data-mk-field="marigold"
          className="m-0 bg-mk-field-bg px-4 py-2 text-[14px] leading-[1.4] font-bold text-mk-fg"
        >
          {C.DRAFT_NOTE}
        </p>
      ) : null}
      <h2
        id={HEADING_ID}
        className="m-0 font-mk-display text-[clamp(32px,4vw,48px)] leading-[1.05] font-bold text-mk-fg"
      >
        {C.H2}
      </h2>
      <p className="m-0 max-w-[68ch] text-[18px] leading-[1.55] text-mk-fg">
        {C.INTRO}
      </p>
      <table className="w-full border-collapse max-md:block">
        <caption className="sr-only">{C.CAPTION}</caption>
        <thead className="max-md:hidden">
          <tr>
            <td className="w-[22%]" />
            <th
              scope="col"
              className="border-t-4 border-mk-tangerine bg-mk-tangerine-tint px-4 py-3 text-left text-[18px] leading-[1.55] font-bold text-mk-ink"
            >
              {C.COL_ELSEWHERE}
            </th>
            <th
              scope="col"
              className="border-t-4 border-mk-leaf bg-mk-leaf-tint px-4 py-3 text-left text-[18px] leading-[1.55] font-bold text-mk-ink"
            >
              {C.COL_CDS}
            </th>
          </tr>
        </thead>
        <tbody className="max-md:flex max-md:flex-col max-md:gap-6">
          {rows.map(({ row, claims: rowClaims }) => (
            <tr
              key={row}
              className="border-t border-mk-rule max-md:flex max-md:flex-col max-md:gap-2 max-md:border-t-0"
            >
              <th
                scope="row"
                className="px-4 py-4 text-left align-top text-[18px] leading-[1.55] font-bold text-mk-fg max-md:px-0 max-md:py-0"
              >
                {C.ROWS[row].header}
              </th>
              <td
                className={`${CELL} bg-mk-tangerine-tint max-md:block max-md:border-t-4 max-md:border-mk-tangerine`}
              >
                <span className={MOBILE_LABEL}>{C.COL_ELSEWHERE}</span>
                {rowClaims.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 ? " " : null}
                    {c.text}
                    <FootnoteRef claimId={c.id} order={refs} />
                    {c.status === "draft" ? (
                      <DraftBadge show={showDrafts} className="ml-1" />
                    ) : null}
                  </span>
                ))}
              </td>
              <td
                className={`${CELL} bg-mk-leaf-tint max-md:block max-md:border-t-4 max-md:border-mk-leaf`}
              >
                <span className={MOBILE_LABEL}>{C.COL_CDS}</span>
                {C.ROWS[row].cds}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <GatewayBand claims={claims} order={refs} anchor />
    </div>
  );
}
