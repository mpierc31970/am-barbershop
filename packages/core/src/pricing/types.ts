// Price catalog and quote types (ONB-06, D79, D181, D264, D299, D300, D314). Pure types.
// Every amount is integer cents. null means "Price coming soon": never a figure (D264).
import type { AddonPath } from "../addons/constants";

export type CatalogItemKind =
  | "plan"
  | "build_fee"
  | "care_plan"
  | "addon"
  | "extra"
  // P10 (BILL-13, BILL-18, D185, D186, D225, D297): billing-only kinds. priceQuote never
  // reads them, so /start and the saved quote are unchanged (Pitfall 8).
  | "pack"
  | "service"
  | "setup_fee";

/** One price_catalog row. plan and build_fee use key "base"; care_plan uses key "care". */
export type CatalogRow = {
  itemKind: CatalogItemKind;
  itemKey: string;
  path: AddonPath;
  monthlyCents: number | null;
  oneTimeCents: number | null;
  installments: number | null;
};

export type BillingCadence = "monthly" | "yearly";

export type QuoteSelections = {
  addons: readonly string[];
  extras: readonly string[];
  carePlan: boolean;
  cadence: BillingCadence;
};

export type QuoteLine = {
  kind: CatalogItemKind;
  key: string;
  monthlyCents: number | null;
  oneTimeCents: number | null;
};

export type QuoteTotals = {
  path: AddonPath;
  cadence: BillingCadence;
  build: {
    cents: number | null;
    installments: number;
    eachCents: number | null;
    lastCents: number | null;
  };
  plan: QuoteLine;
  addons: QuoteLine[];
  extras: QuoteLine[];
  carePlan: QuoteLine | null;
  /** Plan + priced add-ons (+ Care Plan) per month. */
  monthlyCents: number;
  /** monthly: monthlyCents; yearly: 10 x (plan + priced add-ons) + Care Plan monthly. */
  recurringFirstChargeCents: number;
  /** Build + priced one-time extras + recurringFirstChargeCents. */
  dueAtCheckoutCents: number;
  /** First build installment + priced extras + recurringFirstChargeCents. */
  dueAtCheckoutWithInstallmentsCents: number;
  /** Build + extras + 12 x monthly (yearly: 10 x flat + 12 x Care Plan). */
  firstYearCents: number;
  unpricedCount: number;
  unpriced: string[];
};

export type QuoteStatus =
  "draft" | "saved" | "submitted" | "expired" | "blocked";

/** A saved quote as the configurator sees it (BILL-05, 10-18: typed here, not in @cds/db). */
export type QuoteView = {
  id: string;
  status: QuoteStatus;
  path: AddonPath | "";
  businessType: string;
  businessTypeOther: string;
  selections: QuoteSelections;
  totals: QuoteTotals | null;
  email: string;
  savedAt: Date | null;
  expiresAt: Date | null;
  updatedAt: Date;
  businessName: string;
  description: string;
};
