// A CdsBilling that records every call (10-09). Tests use it to prove "no billing call"
// (`spy.calls.length === 0`, the AGR-02 gate test in 10-16) or to feed canned results into
// handlers. A canned entry is either a value (resolved as-is) or a function of the args.
// Methods without a canned entry return a neutral default, or reject for the fetch and
// webhook calls, where a silent default would hide a test bug.
import type {
  CdsBilling,
  ProviderInvoice,
  ProviderSubscription,
} from "@cds/core/payments";

type Methods = Omit<CdsBilling, "provider">;
type MethodName = keyof Methods;

export type BillingSpyCall = { method: string; args: unknown[] };

export type BillingSpyCanned = {
  [K in MethodName]?:
    | Awaited<ReturnType<Methods[K]>>
    | ((...args: Parameters<Methods[K]>) => ReturnType<Methods[K]>);
};

export type BillingSpy = CdsBilling & {
  calls: BillingSpyCall[];
  callsTo(method: MethodName): BillingSpyCall[];
};

const AT = "2026-01-01T00:00:00.000Z";

const emptyInvoice: ProviderInvoice = {
  id: "in_spy",
  number: "SPY-0001",
  customerId: "cus_spy",
  subscriptionId: null,
  orgId: null,
  status: "open",
  totalCents: 0,
  taxCents: 0,
  refundedCents: 0,
  createdAt: AT,
  description: "",
  hostedUrl: null,
  pdfUrl: null,
  lines: [],
  metadata: {},
};

const emptySubscription: ProviderSubscription = {
  id: "sub_spy",
  customerId: "cus_spy",
  orgId: null,
  status: "canceled",
  items: [],
  cancelAt: null,
  pendingUpdate: false,
};

const DEFAULTS: { [K in MethodName]?: Awaited<ReturnType<Methods[K]>> } = {
  ensureCustomer: { customerId: "cus_spy" },
  createCheckout: {
    sessionId: "cs_spy",
    url: "https://billing-spy.invalid/checkout",
  },
  expireCheckout: "expired",
  changeItems: { applied: true, invoice: null },
  previewChange: {
    todayCents: 0,
    taxCents: 0,
    thenMonthlyCents: 0,
    periodEnd: AT,
  },
  createInvoice: emptyInvoice,
  refundAll: { refundedCents: 0, count: 0 },
  cancel: emptySubscription,
  listInvoices: [],
  syncPrice: { priceRef: "price_spy", productRef: "prod_spy" },
  reportUsage: undefined,
  portalUrl: "https://billing-spy.invalid/portal",
  reconcile: [],
};

const METHODS: readonly MethodName[] = [
  "ensureCustomer",
  "createCheckout",
  "expireCheckout",
  "changeItems",
  "previewChange",
  "createInvoice",
  "refundAll",
  "cancel",
  "listInvoices",
  "syncPrice",
  "reportUsage",
  "portalUrl",
  "fetchSubscription",
  "fetchInvoice",
  "fetchCheckoutSession",
  "normaliseWebhook",
  "reconcile",
];

export function createBillingSpy(canned: BillingSpyCanned = {}): BillingSpy {
  const calls: BillingSpyCall[] = [];
  const spy: Record<string, unknown> = {
    provider: "fake",
    calls,
    callsTo: (method: MethodName) => calls.filter((c) => c.method === method),
  };
  for (const method of METHODS) {
    spy[method] = (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args });
      const entry = canned[method] as unknown;
      if (typeof entry === "function") {
        return Promise.resolve().then(() =>
          (entry as (...a: unknown[]) => unknown)(...args),
        );
      }
      if (entry !== undefined) return Promise.resolve(entry);
      if (method in DEFAULTS) return Promise.resolve(DEFAULTS[method]);
      return Promise.reject(
        new Error(`billing spy: no canned result for ${method}`),
      );
    };
  }
  return spy as unknown as BillingSpy;
}
