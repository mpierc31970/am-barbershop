// 10-29 Task 1: Settings › Billing view builder (BILL-03, BILL-08, BILL-13, BILL-16, BILL-19; D82).
// @cds/db is mocked: the builder maps mirrored rows only and never calls the provider.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  readBillingAccount: vi.fn(),
  listBillingInvoices: vi.fn(),
  listWorkOrders: vi.fn(),
  carePlanUsage: vi.fn(),
  mediaUsage: vi.fn(),
  mediaAllowance: vi.fn(),
  listOrgAddons: vi.fn(),
  readPriceCatalog: vi.fn(),
  getOrgStage: vi.fn(),
  pagesUsage: vi.fn(),
  formatGb: (b: number) => `${Math.round((b / 1024 ** 3) * 10) / 10} GB`,
  packRemoveRefusedCopy: (used: number, left: number) =>
    `refused:${used}:${left}`,
  INSTALLMENT_KEY: "build-installment",
  INSTALLMENT_REMAINDER_KEY: "build-remainder",
}));
vi.mock("@cds/db", () => db);

const { buildBillingTabView, invoiceRows, packRemoveRefusal } =
  await import("../lib/billing-view");

const GB = 1024 ** 3;
const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const registry = {
  get: (slug: unknown) =>
    slug === "testimonials"
      ? ({ slug, name: "Testimonials", order: 10 } as never)
      : undefined,
};

const ACCOUNT = {
  id: "ba1",
  organization: "org1",
  provider: "fake",
  status: "active",
  cadence: "monthly",
  buildPlan: "full",
  installmentsPaid: 0,
  paidAt: "2026-10-08T15:00:00.000Z",
  carePlan: true,
  media5gbQty: 1,
  media25gbQty: 0,
  currentPeriodEnd: "2026-11-08T15:00:00.000Z",
  lapsedAt: null,
  priceLockedUntil: null,
  amountDueCents: 0,
  cardBrand: "visa",
  cardLast4: "4242",
  cardExp: "08/28",
  declinedAt: null,
  restoredAt: null,
  itemPrices: [] as unknown[],
  updated: "",
};

const CATALOG = [
  {
    itemKind: "plan",
    itemKey: "base",
    path: "standard",
    monthlyCents: 3900,
    oneTimeCents: null,
    installments: null,
  },
  {
    itemKind: "build_fee",
    itemKey: "base",
    path: "standard",
    monthlyCents: null,
    oneTimeCents: 150000,
    installments: 6,
  },
  {
    itemKind: "addon",
    itemKey: "testimonials",
    path: "standard",
    monthlyCents: 900,
    oneTimeCents: null,
    installments: null,
  },
  {
    itemKind: "pack",
    itemKey: "media-5gb",
    path: "standard",
    monthlyCents: 500,
    oneTimeCents: null,
    installments: null,
  },
  {
    itemKind: "care_plan",
    itemKey: "care",
    path: "standard",
    monthlyCents: 9900,
    oneTimeCents: null,
    installments: null,
  },
];

const INVOICES = [
  {
    id: "i1",
    number: "CDS-0041",
    issuedAt: "2026-10-08T15:00:00.000Z",
    description: "Website build and first month",
    kind: "checkout",
    amountCents: 153900,
    taxCents: 0,
    refundedCents: 0,
    status: "paid",
    hasInstallment: false,
    hostedUrl: "/test-pay/invoice/in_fake_aaaaaaaaaaaaaaa",
    pdfUrl: null,
  },
  {
    id: "i2",
    number: "CDS-0042",
    issuedAt: "2026-10-12T15:00:00.000Z",
    description: "",
    kind: "change",
    amountCents: 4150,
    taxCents: 0,
    refundedCents: 0,
    status: "open",
    hasInstallment: false,
    hostedUrl: null,
    pdfUrl: "https://x.example/p.pdf",
  },
];

function addon(status: "active" | "disabled", reason = "") {
  return {
    id: "r1",
    addon: "testimonials",
    status,
    disabled_reason: reason,
    source: "hub",
    installed_version: "1",
    seeded: {},
    installed_at: "",
    disabled_at: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.readBillingAccount.mockResolvedValue(ACCOUNT);
  db.listBillingInvoices.mockResolvedValue(INVOICES);
  db.listWorkOrders.mockResolvedValue([]);
  db.carePlanUsage.mockResolvedValue({
    on: true,
    usedMinutes: 25,
    monthLabel: "October",
    resetLabel: "1 Nov",
    entries: [{ date: "15 Oct", minutes: 25, note: "Hours update" }],
    totalEntries: 1,
  });
  db.mediaUsage.mockResolvedValue({ usedBytes: 1.2 * GB });
  db.mediaAllowance.mockResolvedValue(7 * GB);
  db.listOrgAddons.mockResolvedValue([addon("active")]);
  db.readPriceCatalog.mockResolvedValue(CATALOG);
  db.pagesUsage.mockResolvedValue({ used: 7, allowance: 10 });
  db.getOrgStage.mockResolvedValue({
    stage: "being_built",
    path: "standard",
    slug: "palm",
  });
});

describe("buildBillingTabView", () => {
  it("paid monthly Standard: strip, plan, items, care, media, invoices", async () => {
    const v = await buildBillingTabView(OWNER as never, { registry });
    expect(v.paid).toBe(true);
    expect(v.canBuy).toBe(true);
    expect(v.status).toEqual({
      ok: true,
      data: {
        state: "paid_up",
        nextBill: { date: "8 Nov 2026", cents: 15200 },
        amountDueCents: null,
        quoteWaiting: null,
        checkoutHref: null,
        updateCardHref: "/hub/settings/billing/card",
      },
    });
    expect(v.plan).toEqual({
      ok: true,
      data: {
        planLine: "Standard website, billed monthly",
        nextBillLine: "8 Nov 2026 · $152.00 plus sales tax",
        cardLine: "Visa ending 4242, expires 08/28",
        priceLockedUntil: null,
      },
    });
    const items = v.items!.ok ? v.items!.data : null;
    expect(items!.rows.map((r) => [r.name, r.amountLabel])).toEqual([
      ["Standard plan", "$39/mo"],
      ["Testimonials", "$9/mo"],
      ["+5 GB storage × 1", "$5/mo"],
      ["Care Plan", "$99/mo"],
    ]);
    expect(items!.monthlyTotalCents).toBe(15200);
    expect(v.care).toMatchObject({
      ok: true,
      data: { on: true, usedMinutes: 25, monthLabel: "October" },
    });
    expect(v.care!.ok && v.care!.data.resetLabel).toMatch(/^Resets on 1 Nov\./);
    expect(v.media).toEqual({
      ok: true,
      data: {
        usedLabel: "1.2 GB",
        allowanceLabel: "7 GB",
        ratio: 1.2 / 7,
        packs5: 1,
        packs25: 0,
        removeRefusal: {},
        prices: {
          "5gb": { add: "$5/mo", current: "$5/mo", drop: "$5" },
          // No catalog row for 25 GB: never an invented number, no Add button.
          "25gb": { add: null, current: null, drop: null },
        },
      },
    });
    expect(v.care!.ok && v.care!.data.addLabel).toBe(
      "Add the Care Plan, $99/mo",
    );
    const inv = v.invoices.ok ? v.invoices.data : [];
    expect(inv.map((r) => [r.number, r.status, r.whatFor, r.href])).toEqual([
      ["CDS-0042", "due", "Change to your plan", "https://x.example/p.pdf"],
      [
        "CDS-0041",
        "paid",
        "Website build and first month",
        "/test-pay/invoice/in_fake_aaaaaaaaaaaaaaa",
      ],
    ]);
  });

  it("WR-C05: pack and Care Plan labels follow a catalog price change", async () => {
    db.readPriceCatalog.mockResolvedValue(
      CATALOG.map((r) =>
        r.itemKey === "media-5gb"
          ? { ...r, monthlyCents: 700 }
          : r.itemKey === "care"
            ? { ...r, monthlyCents: 11900 }
            : r,
      ),
    );
    const v = await buildBillingTabView(OWNER as never, { registry });
    expect(v.media!.ok && v.media!.data.prices["5gb"].add).toBe("$7/mo");
    expect(v.care!.ok && v.care!.data.addLabel).toBe(
      "Add the Care Plan, $119/mo",
    );
    db.readPriceCatalog.mockResolvedValue(
      CATALOG.filter((r) => r.itemKind !== "care_plan"),
    );
    const unset = await buildBillingTabView(OWNER as never, { registry });
    expect(unset.care!.ok && unset.care!.data.addLabel).toBeNull();
  });

  it("not paid: not_paid strip with checkout link when eligible, no plan sections", async () => {
    db.readBillingAccount.mockResolvedValue(null);
    db.listWorkOrders.mockResolvedValue([
      {
        id: "w1",
        title: "Homepage polish",
        status: "sent",
        sentLabel: "8 Oct",
        totalCents: 22000,
        href: "/hub/settings/quotes/w1",
      },
    ]);
    const v = await buildBillingTabView(OWNER as never, { registry });
    expect(v.paid).toBe(false);
    expect(v.canBuy).toBe(false);
    expect(v.status.ok && v.status.data).toMatchObject({
      state: "not_paid",
      checkoutHref: "/hub/checkout",
      quoteWaiting: {
        title: "Homepage polish",
        href: "/hub/settings/quotes/w1",
      },
    });
    expect([v.plan, v.items, v.care, v.media]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(v.quotes.ok && v.quotes.data).toHaveLength(1);
  });

  it("not paid and not yet sent to CDS: no checkout link", async () => {
    db.readBillingAccount.mockResolvedValue(null);
    db.getOrgStage.mockResolvedValue({
      stage: "setup",
      path: "standard",
      slug: "p",
    });
    const v = await buildBillingTabView(OWNER as never, { registry });
    expect(v.status.ok && v.status.data.checkoutHref).toBeNull();
  });

  it("past due carries the amount due", async () => {
    db.readBillingAccount.mockResolvedValue({
      ...ACCOUNT,
      status: "past_due",
      amountDueCents: 15200,
    });
    const v = await buildBillingTabView(OWNER as never, { registry });
    expect(v.status.ok && v.status.data).toMatchObject({
      state: "past_due",
      amountDueCents: 15200,
    });
    expect(v.canBuy).toBe(true);
  });

  it("paused: strip paused with the amount, paused add-on rows, no buying", async () => {
    db.readBillingAccount.mockResolvedValue({
      ...ACCOUNT,
      status: "lapsed",
      amountDueCents: 15200,
    });
    db.listOrgAddons.mockResolvedValue([addon("disabled", "billing_lapse")]);
    const v = await buildBillingTabView(OWNER as never, { registry });
    expect(v.status.ok && v.status.data).toMatchObject({
      state: "paused",
      amountDueCents: 15200,
    });
    const rows = v.items!.ok ? v.items!.data.rows : [];
    expect(rows.find((r) => r.name === "Testimonials")).toMatchObject({
      paused: true,
    });
    expect(v.canBuy).toBe(false);
  });

  it("owner-uninstalled add-ons are not listed", async () => {
    db.listOrgAddons.mockResolvedValue([addon("disabled", "uninstalled")]);
    const v = await buildBillingTabView(OWNER as never, { registry });
    const rows = v.items!.ok ? v.items!.data.rows : [];
    expect(rows.some((r) => r.name === "Testimonials")).toBe(false);
  });

  it("installments: 'payment 3 of 6' and when they end", async () => {
    db.readBillingAccount.mockResolvedValue({
      ...ACCOUNT,
      buildPlan: "installments",
      installmentsPaid: 2,
      carePlan: false,
      media5gbQty: 0,
    });
    const v = await buildBillingTabView(OWNER as never, { registry });
    const rows = v.items!.ok ? v.items!.data.rows : [];
    expect(rows.at(-1)).toMatchObject({
      name: "Website build, payment 3 of 6",
      amountLabel: "$250/mo",
      note: "Ends after 8 Feb 2027.",
    });
  });

  it("WR-D04: a price-locked owner sees the subscribed prices, not the live catalog", async () => {
    // The catalog says $39 / $9 / $5 / $99; this subscription was locked at older prices.
    db.readBillingAccount.mockResolvedValue({
      ...ACCOUNT,
      priceLockedUntil: "2028-10-08T00:00:00.000Z",
      itemPrices: [
        {
          kind: "plan",
          key: "base",
          interval: "month",
          unitCents: 2900,
          quantity: 1,
        },
        {
          kind: "addon",
          key: "testimonials",
          interval: "month",
          unitCents: 700,
          quantity: 1,
        },
        {
          kind: "pack",
          key: "media-5gb",
          interval: "month",
          unitCents: 400,
          quantity: 1,
        },
        {
          kind: "care_plan",
          key: "care",
          interval: "month",
          unitCents: 8900,
          quantity: 1,
        },
      ],
    });
    const v = await buildBillingTabView(OWNER as never, { registry });
    const items = v.items!.ok ? v.items!.data : null;
    expect(items!.rows.map((r) => [r.name, r.amountLabel])).toEqual([
      ["Standard plan", "$29/mo"],
      ["Testimonials", "$7/mo"],
      ["+5 GB storage × 1", "$4/mo"],
      ["Care Plan", "$89/mo"],
    ]);
    expect(items!.monthlyTotalCents).toBe(2900 + 700 + 400 + 8900);
    expect(v.plan!.ok && v.plan!.data.nextBillLine).toBe(
      "8 Nov 2026 · $129.00 plus sales tax",
    );
    // A new pack is offered at today's price; the one held reads (and drops by) the old one.
    expect(v.media!.ok && v.media!.data.prices["5gb"]).toEqual({
      add: "$5/mo",
      current: "$4/mo",
      drop: "$4",
    });
  });

  it("WR-D04: yearly next bill counts the monthly lines too; an unpriced plan is never Included", async () => {
    db.readBillingAccount.mockResolvedValue({ ...ACCOUNT, cadence: "yearly" });
    const v = await buildBillingTabView(OWNER as never, { registry });
    // Plan + add-on yearly (10 x ($39 + $9)) plus pack and Care Plan monthly ($5 + $99).
    expect(v.status.ok && v.status.data.nextBill?.cents).toBe(
      10 * (3900 + 900) + 500 + 9900,
    );
    db.readPriceCatalog.mockResolvedValue(
      CATALOG.map((r) =>
        r.itemKind === "plan" ? { ...r, monthlyCents: null } : r,
      ),
    );
    const unpriced = await buildBillingTabView(OWNER as never, { registry });
    const rows = unpriced.items!.ok ? unpriced.items!.data.rows : [];
    expect(rows[0]).toMatchObject({
      name: "Standard plan",
      amountLabel: "Price coming soon",
    });
  });

  it("one failing section renders ERR-LOAD in place; the rest still render", async () => {
    db.listBillingInvoices.mockRejectedValue(new Error("down"));
    db.carePlanUsage.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const v = await buildBillingTabView(OWNER as never, { registry });
    err.mockRestore();
    expect(v.invoices).toEqual({ ok: false });
    expect(v.care).toEqual({ ok: false });
    expect(v.plan!.ok).toBe(true);
    expect(v.status.ok).toBe(true);
  });

  it("impersonating owner reads but cannot buy", async () => {
    const v = await buildBillingTabView(
      { ...OWNER, impersonator: "s1" } as never,
      { registry },
    );
    expect(v.canBuy).toBe(false);
    expect(v.impersonating).toBe(true);
  });
});

describe("pages packs on Settings › Billing (11-28)", () => {
  const PAGES_ROW = {
    itemKind: "pack",
    itemKey: "pages-5",
    path: "standard",
    monthlyCents: 1000,
    oneTimeCents: null,
    installments: null,
  };

  it("lists +5 pages × 1 at $10/mo in What you pay for, removable", async () => {
    db.readBillingAccount.mockResolvedValue({ ...ACCOUNT, pages5Qty: 1 });
    db.readPriceCatalog.mockResolvedValue([...CATALOG, PAGES_ROW]);
    db.pagesUsage.mockResolvedValue({ used: 9, allowance: 15 });
    const v = await buildBillingTabView(OWNER as never, { registry });
    const rows = v.items!.ok ? v.items!.data.rows : [];
    const row = rows.find((r) => r.name === "+5 pages × 1");
    expect(row).toMatchObject({ amountLabel: "$10/mo", key: "pack:pages-5" });
    expect(v.items!.ok && v.items!.data.monthlyTotalCents).toBe(16200);
    expect(v.pagePacks).toEqual({
      ok: true,
      data: {
        qty: 1,
        allowance: 15,
        dropLabel: "$10",
        removeRefusal: null,
      },
    });
  });

  it("Remove one is refused in place while pages exceed what is left", async () => {
    db.readBillingAccount.mockResolvedValue({ ...ACCOUNT, pages5Qty: 1 });
    db.readPriceCatalog.mockResolvedValue([...CATALOG, PAGES_ROW]);
    db.pagesUsage.mockResolvedValue({ used: 13, allowance: 15 });
    const v = await buildBillingTabView(OWNER as never, { registry });
    expect(v.pagePacks!.ok && v.pagePacks!.data.removeRefusal).toBe(
      "You have 13 pages, more than the 10 you'd have left. Delete 3 pages first, then remove the pack.",
    );
  });

  it("no pages pack: no row and no section", async () => {
    const v = await buildBillingTabView(OWNER as never, { registry });
    const rows = v.items!.ok ? v.items!.data.rows : [];
    expect(rows.some((r) => r.name.startsWith("+5 pages"))).toBe(false);
    expect(v.pagePacks).toBeNull();
  });
});

describe("helpers", () => {
  it("packRemoveRefusal refuses per size when that removal overfills", () => {
    expect(packRemoveRefusal(1 * GB, 1, 0)).toEqual({});
    expect(packRemoveRefusal(6.2 * GB, 1, 0)).toEqual({
      "5gb": `refused:${6.2 * GB}:${2 * GB}`,
    });
    expect(packRemoveRefusal(1 * GB, 0, 0)).toEqual({});
  });

  it("WR-C06: one 5 GB and one 25 GB pack, 20 GB in use: only the 25 GB removal is refused", () => {
    // 32 GB now; minus 5 GB leaves 27 GB (fine), minus 25 GB leaves 7 GB (refused).
    expect(packRemoveRefusal(20 * GB, 1, 1)).toEqual({
      "25gb": `refused:${20 * GB}:${7 * GB}`,
    });
    // 3 GB in use: both removals are fine.
    expect(packRemoveRefusal(3 * GB, 1, 1)).toEqual({});
  });

  it("invoiceRows drops drafts and maps statuses", () => {
    const rows = invoiceRows([
      { ...INVOICES[0]!, status: "draft" },
      { ...INVOICES[1]!, status: "uncollectible" },
    ] as never);
    expect(rows.map((r) => r.status)).toEqual(["unpaid"]);
  });
});
