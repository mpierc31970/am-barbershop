// Owner: 15-12 (P15-P1). ClaimFootnotes + FootnoteRef (15-UI-SPEC "Comparison", Accessibility contract;
// HUB-06, A2-Q3). Two-way links: a ref `<sup><a href="#claim-<id>" id="ref-<id>">[n]</a></sup>` after each
// claim, and a numbered marigold-band footnote "[n] <source title> (new tab). Checked <date>." with
// "Back to text" to `#ref-<id>`. Numbers come from footnoteOrder() (ComparisonTable), first appearance.
// Server-safe: no hooks, so the calculator island can import FootnoteRef too.
import { ExternalLink } from "lucide-react";
import {
  MK_COPY,
  checkedLine,
  formatCheckedDate,
  type Claim,
} from "@cds/core/marketing";
import { DraftBadge, shownClaims, shownOrder } from "./DraftBadge";

export const claimAnchorId = (id: string) => `claim-${id}`;
export const refAnchorId = (id: string) => `ref-${id}`;

/** The footnote number for a claim id (1-based), or null when it is not in the order. */
export function footnoteNumber(
  order: readonly string[],
  id: string,
): number | null {
  const i = order.indexOf(id);
  return i < 0 ? null : i + 1;
}

export type FootnoteRefProps = {
  claimId: string;
  order: readonly string[];
  /** Carry `id="ref-<id>"` (the first appearance only, so ids stay unique). */
  anchor?: boolean;
};

/** "[n]" superscript link to the footnote; 44px hit area via padding (UI-SPEC "Footnote refs"). */
export function FootnoteRef({
  claimId,
  order,
  anchor = true,
}: FootnoteRefProps) {
  const n = footnoteNumber(order, claimId);
  if (n === null) return null;
  return (
    <sup className="mk-figures text-[14px] leading-none">
      <a
        href={`#${claimAnchorId(claimId)}`}
        id={anchor ? refAnchorId(claimId) : undefined}
        className="-my-3 inline-block px-2 py-3 text-mk-ink underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
      >
        [{n}]
      </a>
    </sup>
  );
}

export type ClaimFootnotesProps = {
  claims: readonly Claim[];
  order: readonly string[];
  /** Dev only (`!isProductionHub()`): DraftBadge on draft footnotes. */
  showDrafts?: boolean;
  className?: string;
};

export function ClaimFootnotes({
  claims: given,
  order: givenOrder,
  showDrafts = false,
  className,
}: ClaimFootnotesProps) {
  // Drafts are dropped here too when hidden (WR-C05); numbering skips them the same way.
  const claims = shownClaims(given, showDrafts);
  const order = shownOrder(givenOrder, given, showDrafts);
  const byId = new Map(claims.map((c) => [c.id, c]));
  const listed = order.flatMap((id) => {
    const c = byId.get(id);
    return c ? [c] : [];
  });
  if (listed.length === 0) return null;
  return (
    <div
      data-mk-field="marigold"
      className={["bg-mk-field-bg px-6 py-6 text-mk-fg", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <ol
        aria-label={MK_COPY.COMPARISON.FOOTNOTES_LABEL}
        className="m-0 flex list-none flex-col gap-3 p-0 text-[14px] leading-[1.4] text-mk-ink"
      >
        {listed.map((c) => (
          <li key={c.id} id={claimAnchorId(c.id)} className="scroll-mt-8">
            <span className="mk-figures font-bold">
              [{footnoteNumber(order, c.id)}]
            </span>{" "}
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
            {". "}
            {checkedLine(formatCheckedDate(c.verifiedOn))}{" "}
            {c.status === "draft" ? (
              <DraftBadge show={showDrafts} className="mr-2" />
            ) : null}
            <a
              href={`#${refAnchorId(c.id)}`}
              className="inline-block py-1 font-bold text-mk-ink underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
            >
              {MK_COPY.COMPARISON.BACK_TO_TEXT}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
