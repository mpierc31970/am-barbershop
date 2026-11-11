// BillingGate port (ADDON-04; D264, D299). Every install asks the gate before it writes.
// P10 (10-20) resolves the P5 GO-LIVE row: `getBillingGate()` returns the billing-backed
// gate (payments/gate.ts, D186). The P5 stand-in stays exported for tests only: it approves
// free of charge and logs one line with the slug and org id only.
import { billingGate } from "../payments/gate";
import type { InstallSource } from "./types";

/** `chargeCents` is the invoice total charged for the install (0 when nothing was charged). */
export type BillingApproval =
  { approved: true; chargeCents: number } | { approved: false; reason: string };

export type BillingGate = {
  approve(input: {
    orgId: string;
    slug: string;
    actor: string;
    source: InstallSource;
    /**
     * The confirm token from `previewAddonCharge` (CR-C01). A hub install that charges is
     * refused "price changed" without one, or when the figures moved since the preview.
     */
    token?: string;
  }): Promise<BillingApproval>;
  /**
   * Owner uninstall (10-20 choice 3): remove the add-on's subscription item with proration
   * credit. Not called for a billing lapse or a staff uninstall. Optional for test gates.
   */
  release?(input: {
    orgId: string;
    slug: string;
    actor: string;
  }): Promise<void>;
};

export function standInBillingGate(): BillingGate {
  return {
    approve({ orgId, slug }) {
      console.info(
        `[billing-standin] approved ${slug} for org ${orgId} at no charge`,
      );
      return Promise.resolve({ approved: true, chargeCents: 0 });
    },
    release() {
      return Promise.resolve();
    },
  };
}

let gate: BillingGate | null = null;

/** The configured gate: the billing-backed gate (BILL-12). */
export function getBillingGate(): BillingGate {
  gate ??= billingGate();
  return gate;
}
