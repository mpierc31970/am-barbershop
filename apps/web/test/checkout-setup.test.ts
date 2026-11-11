// 10-22 Task 3: the "Pay and start your build" Setup item rule (10-UI-SPEC "Setup item";
// AGR-02, BILL-01). Pure: the same rule feeds the Setup panel and the sidebar count.
import { describe, expect, it } from "vitest";
import type { AgreementSetupItem } from "../lib/agreement-setup";
import {
  CHECKOUT_ITEM_COPY,
  checkoutCountsAsRequired,
  checkoutSetupItem,
  paidOnDate,
  type CheckoutSetupInput,
} from "../lib/checkout-setup";

const SIGNED: AgreementSetupItem = {
  state: "signed",
  canSign: true,
  signedOn: "8 Oct 2026",
};
const NEEDED: AgreementSetupItem = {
  state: "needed",
  canSign: true,
  signedOn: null,
};
const OPEN = { closed: false, paidAt: null, paymentsOpen: true };

function input(over: Partial<CheckoutSetupInput> = {}): CheckoutSetupInput {
  return {
    stage: "ready_for_build",
    agreement: SIGNED,
    checkout: OPEN,
    role: "owner",
    impersonating: false,
    ...over,
  };
}

describe("checkoutSetupItem", () => {
  it("sent, not signed: After you sign your agreement (no pay action)", () => {
    const item = checkoutSetupItem(input({ agreement: NEEDED }));
    expect(item).toEqual({
      state: "after_sign",
      label: "After you sign your agreement.",
      canPay: false,
      paidOn: null,
    });
    expect(checkoutCountsAsRequired(item)).toBe(true);
  });

  it("held (fit_review): the held label", () => {
    const item = checkoutSetupItem(
      input({ stage: "fit_review", agreement: null }),
    );
    expect(item?.state).toBe("held");
    expect(item?.label).toBe(
      "Checkout opens once CDS has checked your details, usually within 2 business days.",
    );
    expect(item?.canPay).toBe(false);
  });

  it("signed, ready, owner: Go to checkout", () => {
    for (const stage of ["ready_for_build", "being_built"]) {
      const item = checkoutSetupItem(input({ stage }));
      expect(item).toEqual({
        state: "ready",
        label: CHECKOUT_ITEM_COPY.ready,
        canPay: true,
        paidOn: null,
      });
    }
  });

  it("signed, ready, Admin or impersonating: Only the site owner can pay", () => {
    for (const over of [{ role: "admin" }, { impersonating: true }]) {
      const item = checkoutSetupItem(input(over));
      expect(item?.state).toBe("not_owner");
      expect(item?.label).toBe("Only the site owner can pay.");
      expect(item?.canPay).toBe(false);
      expect(checkoutCountsAsRequired(item)).toBe(true);
    }
  });

  it("paid: a done row with the date; not counted", () => {
    const item = checkoutSetupItem(
      input({
        stage: "being_built",
        checkout: { ...OPEN, paidAt: "2026-10-08T15:00:00.000Z" },
        timeZone: "America/Chicago",
      }),
    );
    expect(item).toEqual({
      state: "paid",
      label: "",
      canPay: false,
      paidOn: "8 Oct",
    });
    expect(checkoutCountsAsRequired(item)).toBe(false);
  });

  it("payments open soon (production on the fake adapter)", () => {
    const item = checkoutSetupItem(
      input({ checkout: { ...OPEN, paymentsOpen: false } }),
    );
    expect(item?.state).toBe("open_soon");
    expect(item?.label).toBe(
      "Checkout opens soon. We'll email you the moment it does.",
    );
    expect(item?.canPay).toBe(false);
  });

  it("not shown before Send to CDS, once closed, or when the state is unread", () => {
    expect(checkoutSetupItem(input({ stage: "intake" }))).toBeNull();
    expect(checkoutSetupItem(input({ stage: "" }))).toBeNull();
    expect(
      checkoutSetupItem(input({ checkout: { ...OPEN, closed: true } })),
    ).toBeNull();
    expect(checkoutSetupItem(input({ checkout: null }))).toBeNull();
    expect(checkoutCountsAsRequired(null)).toBe(false);
  });
});

describe("paidOnDate", () => {
  it("formats in the business time zone and survives bad input", () => {
    expect(paidOnDate("2026-10-09T02:00:00.000Z", "America/Chicago")).toBe(
      "8 Oct",
    );
    expect(paidOnDate("2026-10-09T02:00:00.000Z", "Not/AZone")).toBe("9 Oct");
    expect(paidOnDate("nope")).toBeNull();
    expect(paidOnDate(null)).toBeNull();
  });
});
