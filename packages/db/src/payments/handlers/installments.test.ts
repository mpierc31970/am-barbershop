// BILL-11 (D181, Pitfall 6): the installment rule is pure and state-based.
import { installmentSplit } from "@cds/core/payments";
import { describe, expect, it } from "vitest";
import { installmentActions, type InstallmentState } from "./installments";

const studio = installmentSplit(350000);
const standard = installmentSplit(150000);

const state = (over: Partial<InstallmentState> = {}): InstallmentState => ({
  buildPlan: "installments",
  paidCount: 1,
  remainderAdded: false,
  itemPresent: true,
  ...studio,
  ...over,
});

describe("installmentActions (BILL-11)", () => {
  it("does nothing for a build paid in full", () => {
    for (const paidCount of [0, 5, 6]) {
      expect(installmentActions(state({ buildPlan: "full", paidCount }))).toBe(
        "none",
      );
    }
    expect(installmentActions(state({ buildPlan: null }))).toBe("none");
  });

  it("does nothing between the 1st and the 4th payment", () => {
    for (const paidCount of [0, 1, 2, 3, 4]) {
      expect(installmentActions(state({ paidCount }))).toBe("none");
    }
  });

  it("adds the remainder after the 5th payment, once", () => {
    expect(studio).toEqual({ eachCents: 58333, lastCents: 58335 });
    expect(installmentActions(state({ paidCount: 5 }))).toBe("add_remainder");
    expect(
      installmentActions(state({ paidCount: 5, remainderAdded: true })),
    ).toBe("none");
  });

  it("skips the remainder when the build splits evenly (Standard 6 x $250)", () => {
    expect(standard).toEqual({ eachCents: 25000, lastCents: 25000 });
    expect(installmentActions(state({ paidCount: 5, ...standard }))).toBe(
      "none",
    );
  });

  it("removes the item after the 6th payment, and only while it is there", () => {
    expect(installmentActions(state({ paidCount: 6 }))).toBe("remove_item");
    expect(installmentActions(state({ paidCount: 7 }))).toBe("remove_item");
    expect(
      installmentActions(state({ paidCount: 6, itemPresent: false })),
    ).toBe("none");
  });
});
