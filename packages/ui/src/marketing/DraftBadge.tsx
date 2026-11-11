// Owner: 15-09 (P15-P1). DraftBadge: "DRAFT" (ink on marigold, 1px ink border; UI-SPEC components).
// Renders only when `show` is true. Callers pass `!isProductionHub()` (P15-P4, A2-Q4): the
// component never reads env itself, so a draft can never leak into production by default.
// shownClaims / shownProof / shownOrder give the content the same guard (WR-C05): with drafts
// hidden, a draft claim or unconfirmed entry is dropped even if the caller forgot visibleClaims()
// / visibleProof(), so the safe state is the default.
import { MK_COPY, type Claim } from "@cds/core/marketing";

/** Claims a component may render: all of them when drafts show, verified ones otherwise. */
export function shownClaims(
  claims: readonly Claim[],
  showDrafts: boolean,
): readonly Claim[] {
  return showDrafts ? claims : claims.filter((c) => c.status === "verified");
}

/** Proof entries a component may render: unconfirmed ones only when drafts show. */
export function shownProof<T extends { readonly confirmed: boolean }>(
  list: readonly T[],
  showDrafts: boolean,
): readonly T[] {
  return showDrafts ? list : list.filter((entry) => entry.confirmed);
}

/** A footnote order minus the claims that shownClaims() hides, so numbers stay 1..n. */
export function shownOrder(
  order: readonly string[],
  claims: readonly Claim[],
  showDrafts: boolean,
): readonly string[] {
  if (showDrafts) return order;
  const hidden = new Set(
    claims.filter((c) => c.status !== "verified").map((c) => c.id),
  );
  return hidden.size === 0 ? order : order.filter((id) => !hidden.has(id));
}

export type DraftBadgeProps = { show: boolean; className?: string };

export function DraftBadge({ show, className }: DraftBadgeProps) {
  if (!show) return null;
  return (
    <span
      className={[
        "inline-flex items-center border border-mk-ink bg-mk-marigold px-2 text-[14px] leading-[1.4] font-bold text-mk-ink",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {MK_COPY.COMMON.DRAFT}
    </span>
  );
}
