// P10 payments: the build fee installment rule (BILL-11; D181; RESEARCH Pitfall 6). Pure.
//
// `paidCount` is always recomputed from the mirrored paid invoices that carry an installment
// line, never incremented, so a replayed or reconciled event cannot double-count.
// - Before the 6th payment (5 paid) the remainder cents (`lastCents - eachCents`, Studio 2¢)
//   are added as their own item, so the 6th invoice totals `lastCents`. Standard ($1,500)
//   splits evenly and needs no remainder.
// - After the 6th paid invoice the installment item (and the remainder item) are removed with
//   no proration.
import { BUILD_INSTALLMENTS } from "@cds/core/payments";

export type InstallmentAction = "none" | "add_remainder" | "remove_item";

export type InstallmentState = {
  buildPlan: "full" | "installments" | null;
  /** Paid invoices carrying an installment line (recomputed). */
  paidCount: number;
  /** The remainder item is already on the subscription. */
  remainderAdded: boolean;
  /** The installment item (or the remainder item) is still on the subscription. */
  itemPresent: boolean;
  /** From installmentSplit(buildCents). */
  eachCents: number;
  lastCents: number;
};

export function installmentActions(s: InstallmentState): InstallmentAction {
  if (s.buildPlan !== "installments") return "none";
  if (s.paidCount >= BUILD_INSTALLMENTS) {
    return s.itemPresent ? "remove_item" : "none";
  }
  if (
    s.paidCount === BUILD_INSTALLMENTS - 1 &&
    !s.remainderAdded &&
    s.lastCents > s.eachCents
  ) {
    return "add_remainder";
  }
  return "none";
}
