// Price catalog chokepoint (ONB-06; CONTEXT A2-Q1, A2-Q2; D181, D264, D299, D300; PD-5).
// readPriceCatalog is public non-tenant data; setPrice is super_admin only (prices_set) and
// audited with before/after (T-06-14, T-06-16, T-06-18).
import { Forbidden, InvalidContext, InvalidInput } from "@cds/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  pendingPriceSyncs,
  priceCase,
  readCatalogBillingRefs,
  readPriceCatalog,
  setPrice,
  syncAllPrices,
} from "../src/catalog";
import { superuser } from "../src/client";
import type { PlatformContext } from "../src/context";
import { createBillingSpy, type BillingSpy } from "./fake-billing-spy";
import { bootSeededPb, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let admin: PlatformContext;
let support: PlatformContext;

describe("price catalog (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
    if (!booted) return;
    admin = await staffContext(
      booted.inst,
      "prices-admin@cds.test",
      "super_admin",
    );
    support = await staffContext(
      booted.inst,
      "prices-support@cds.test",
      "support_agent",
    );
  });

  afterAll(async () => {
    await booted?.inst.stop();
  });

  it("reads the 33 active seeded rows (P6 + P10), unpriced as null", async (ctx) => {
    if (!booted) return ctx.skip();
    const rows = await readPriceCatalog();
    // 35 seeded; Studio's Newsletter and Landing pages rows wait inactive (WR-A02).
    expect(rows).toHaveLength(33);
    const find = (kind: string, key: string, path: string) =>
      rows.find(
        (r) => r.itemKind === kind && r.itemKey === key && r.path === path,
      );
    expect(find("plan", "base", "standard")?.monthlyCents).toBe(3900);
    expect(find("plan", "base", "standard")?.oneTimeCents).toBeNull();
    expect(find("build_fee", "base", "studio")).toMatchObject({
      oneTimeCents: 350000,
      installments: 6,
    });
    const testimonials = find("addon", "testimonials", "standard");
    expect(testimonials?.monthlyCents).toBeNull();
    expect(testimonials?.oneTimeCents).toBeNull();
  });

  it("super_admin sets a price, audited with before/after", async (ctx) => {
    if (!booted) return ctx.skip();
    const res = await setPrice(admin, {
      kind: "addon",
      key: "testimonials",
      path: "standard",
      monthlyCents: 900,
    });
    expect(res.before?.monthlyCents).toBeNull();
    expect(res.after.monthlyCents).toBe(900);
    const rows = await readPriceCatalog();
    const row = rows.find(
      (r) =>
        r.itemKind === "addon" &&
        r.itemKey === "testimonials" &&
        r.path === "standard",
    );
    expect(row?.monthlyCents).toBe(900);

    const pb = await superuser();
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = {:a}", { a: "price_catalog.set" }),
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const last = audit[audit.length - 1]!;
    expect(last.organization).toBe("");
    expect(last.actor).toBe(admin.actor);
    expect(last.meta).toMatchObject({
      kind: "addon",
      key: "testimonials",
      path: "standard",
    });
  });

  it("null cents marks the row unpriced again", async (ctx) => {
    if (!booted) return ctx.skip();
    await setPrice(admin, {
      kind: "addon",
      key: "credentials",
      path: "studio",
      monthlyCents: 1500,
    });
    const res = await setPrice(admin, {
      kind: "addon",
      key: "credentials",
      path: "studio",
      monthlyCents: null,
    });
    expect(res.before?.monthlyCents).toBe(1500);
    expect(res.after.monthlyCents).toBeNull();
    const pb = await superuser();
    const raw = await pb.collection("price_catalog").getFirstListItem(
      pb.filter("item_kind = {:k} && item_key = {:key} && path = {:p}", {
        k: "addon",
        key: "credentials",
        p: "studio",
      }),
    );
    expect(raw.priced).toBe(false);
  });

  it("rejects negative, non-integer and oversized cents", async (ctx) => {
    if (!booted) return ctx.skip();
    const base = {
      kind: "extra",
      key: "copywriting",
      path: "standard",
    } as const;
    await expect(
      setPrice(admin, { ...base, oneTimeCents: -1 }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      setPrice(admin, { ...base, oneTimeCents: 12.5 }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      setPrice(admin, { ...base, oneTimeCents: 10_000_001 }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      setPrice(admin, { ...base, key: "Bad Key!", oneTimeCents: 100 }),
    ).rejects.toThrow(InvalidInput);
  });

  it("refuses a Studio Booking price on the Standard path (review WR-A03, D176)", async (ctx) => {
    if (!booted) return ctx.skip();
    await expect(
      setPrice(admin, {
        kind: "addon",
        key: "studio-booking-solo",
        path: "standard",
        monthlyCents: 4900,
      }),
    ).rejects.toThrow(InvalidInput);
    const rows = await readPriceCatalog();
    expect(
      rows.some(
        (r) => r.itemKey.startsWith("studio-booking") && r.path === "standard",
      ),
    ).toBe(false);
  });

  it("priceCase reads the current price and the orgs on the path (review WR-A03)", async (ctx) => {
    if (!booted) return ctx.skip();
    const pb = await superuser();
    const onStandard = (
      await pb.collection("organizations").getList(1, 1, {
        filter: "path = 'standard'",
      })
    ).totalItems;
    const c = await priceCase(admin, {
      kind: "addon",
      key: "builder-pro",
      path: "studio",
    });
    expect(c.currentCents).toBe(0);
    const std = await priceCase(admin, {
      kind: "addon",
      key: "nope-not-a-row",
      path: "standard",
    });
    expect(std).toEqual({ currentCents: null, pathOrgs: onStandard });
    await expect(
      priceCase(support, { kind: "addon", key: "builder-pro", path: "studio" }),
    ).rejects.toThrow(Forbidden);
  });

  it("support_agent is Forbidden and an OrgContext is refused", async (ctx) => {
    if (!booted) return ctx.skip();
    const input = {
      kind: "plan",
      key: "base",
      path: "standard",
      monthlyCents: 1,
    } as const;
    await expect(setPrice(support, input)).rejects.toThrow(Forbidden);
    await expect(
      setPrice(booted.seed.ctxA as unknown as PlatformContext, input),
    ).rejects.toThrow(InvalidContext);
    const rows = await readPriceCatalog();
    const plan = rows.find(
      (r) => r.itemKind === "plan" && r.path === "standard",
    );
    expect(plan?.monthlyCents).toBe(3900);
  });

  it("creates a missing row (a new add-on)", async (ctx) => {
    if (!booted) return ctx.skip();
    const res = await setPrice(admin, {
      kind: "addon",
      key: "newsletter",
      path: "standard",
      monthlyCents: 1200,
    });
    expect(res.before).toBeNull();
    expect(res.after).toMatchObject({
      itemKind: "addon",
      itemKey: "newsletter",
      path: "standard",
      monthlyCents: 1200,
    });
    const all = await readPriceCatalog();
    expect(all).toHaveLength(34);
    // A-WR-09: the audit row (same batch) records exactly what was stored.
    const stored = all.find(
      (r) => r.itemKey === "newsletter" && r.path === "standard",
    );
    const pb = await superuser();
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'price_catalog.set'", {}),
    });
    const row = audit.find(
      (a) => (a.meta as { key?: string }).key === "newsletter",
    );
    expect(row?.target_id).toBeTruthy();
    expect((row?.meta as { after?: unknown }).after).toEqual(stored);
  });

  // ------------------------------------------------------------------------------------
  // P10 (10-11): the catalog is the billing source (BILL-18, D161, D264).

  type SyncArgs = {
    kind: string;
    key: string;
    path: string;
    interval: string;
    cents: number;
    productRef: string | null;
    previousPriceRef: string | null;
  };
  const syncArgs = (spy: BillingSpy): SyncArgs[] =>
    spy.callsTo("syncPrice").map((c) => c.args[0] as SyncArgs);
  const cannedSpy = (): BillingSpy =>
    createBillingSpy({
      syncPrice: async (input) => ({
        priceRef: `price_${input.key}_${input.path}_${input.interval}_${input.cents}`,
        productRef: input.productRef ?? `prod_${input.key}_${input.path}`,
      }),
    });
  const rawRow = async (kind: string, key: string, path: string) => {
    const pb = await superuser();
    return pb.collection("price_catalog").getFirstListItem(
      pb.filter("item_kind = {:k} && item_key = {:key} && path = {:p}", {
        k: kind,
        key,
        p: path,
      }),
    );
  };

  it("accepts pack (monthly), service and setup_fee (one-time); rejects unknown kinds", async (ctx) => {
    if (!booted) return ctx.skip();
    const spy = cannedSpy();
    await setPrice(
      admin,
      { kind: "pack", key: "media-5gb", path: "standard", monthlyCents: 600 },
      { billing: spy },
    );
    await setPrice(
      admin,
      {
        kind: "service",
        key: "polish-hour",
        path: "studio",
        oneTimeCents: 12000,
      },
      { billing: spy },
    );
    expect(syncArgs(spy).map((a) => [a.key, a.interval, a.cents])).toEqual([
      ["media-5gb", "month", 600],
      ["polish-hour", "once", 12000],
    ]);
    await expect(
      setPrice(
        admin,
        { kind: "setup_fee", key: "addon", path: "standard", monthlyCents: 1 },
        { billing: spy },
      ),
    ).rejects.toThrow(InvalidInput);
    await expect(
      setPrice(
        admin,
        {
          kind: "bundle" as never,
          key: "x",
          path: "standard",
          monthlyCents: 1,
        },
        { billing: spy },
      ),
    ).rejects.toThrow(InvalidInput);
    expect(spy.callsTo("syncPrice")).toHaveLength(2);
  });

  it("an addon price change syncs month + year (10x) with the previous refs, in the audited batch", async (ctx) => {
    if (!booted) return ctx.skip();
    const spy = cannedSpy();
    const input = {
      kind: "addon",
      key: "builder-pro",
      path: "standard",
    } as const;
    await setPrice(admin, { ...input, monthlyCents: 1300 }, { billing: spy });
    expect(syncArgs(spy)).toEqual([
      {
        kind: "addon",
        key: "builder-pro",
        path: "standard",
        interval: "month",
        cents: 1300,
        productRef: null,
        previousPriceRef: null,
      },
      {
        kind: "addon",
        key: "builder-pro",
        path: "standard",
        interval: "year",
        cents: 13000,
        productRef: "prod_builder-pro_standard",
        previousPriceRef: null,
      },
    ]);

    const spy2 = cannedSpy();
    const res = await setPrice(
      admin,
      { ...input, monthlyCents: 1500 },
      { billing: spy2 },
    );
    expect(res.synced).toBe(2);
    const second = syncArgs(spy2);
    expect(second).toHaveLength(2);
    expect(second[0]).toMatchObject({
      interval: "month",
      cents: 1500,
      productRef: "prod_builder-pro_standard",
      previousPriceRef: "price_builder-pro_standard_month_1300",
    });
    expect(second[1]).toMatchObject({
      interval: "year",
      cents: 15000,
      previousPriceRef: "price_builder-pro_standard_year_13000",
    });

    const raw = await rawRow("addon", "builder-pro", "standard");
    expect(raw.monthly_cents).toBe(1500);
    expect(raw.stripe_product).toBe("prod_builder-pro_standard");
    expect(raw.stripe_price_monthly).toBe(
      "price_builder-pro_standard_month_1500",
    );
    expect(raw.stripe_price_yearly).toBe(
      "price_builder-pro_standard_year_15000",
    );

    const pb = await superuser();
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'price_catalog.set' && target_id = {:id}", {
        id: raw.id,
      }),
      sort: "created",
    });
    const last = audit[audit.length - 1]!;
    expect(last.meta).toMatchObject({
      before: { monthlyCents: 1300 },
      after: { monthlyCents: 1500 },
    });
    expect(JSON.stringify(last.meta)).not.toContain("price_");
    expect(JSON.stringify(last.meta)).not.toContain("prod_");
  });

  it("an unchanged amount or null makes no provider call and keeps the refs", async (ctx) => {
    if (!booted) return ctx.skip();
    const spy = cannedSpy();
    const input = {
      kind: "addon",
      key: "builder-pro",
      path: "standard",
    } as const;
    const same = await setPrice(
      admin,
      { ...input, monthlyCents: 1500 },
      { billing: spy },
    );
    expect(same.synced).toBe(0);
    const unset = await setPrice(
      admin,
      { ...input, monthlyCents: null },
      { billing: spy },
    );
    expect(unset.synced).toBe(0);
    expect(spy.callsTo("syncPrice")).toHaveLength(0);
    const raw = await rawRow("addon", "builder-pro", "standard");
    expect(raw.priced).toBe(false);
    expect(raw.stripe_price_monthly).toBe(
      "price_builder-pro_standard_month_1500",
    );
    // Restore the seeded price for the tests below.
    await setPrice(admin, { ...input, monthlyCents: 1200 }, { billing: spy });
  });

  it("a build fee syncs the full price once and the installment monthly", async (ctx) => {
    if (!booted) return ctx.skip();
    const spy = cannedSpy();
    await setPrice(
      admin,
      { kind: "build_fee", key: "base", path: "studio", oneTimeCents: 360000 },
      { billing: spy },
    );
    // CR-E01: the monthly price is tagged as the installment (Stripe reads kinds by price).
    expect(
      syncArgs(spy).map((a) => [a.interval, a.cents, a.kind, a.key]),
    ).toEqual([
      ["once", 360000, "build_fee", "base"],
      ["month", 60000, "installment", "build-installment"],
    ]);
  });

  it("readPriceCatalog carries no provider ids; readCatalogBillingRefs does", async (ctx) => {
    if (!booted) return ctx.skip();
    const rows = await readPriceCatalog();
    for (const r of rows) {
      expect(Object.keys(r).some((k) => /stripe|ref/i.test(k))).toBe(false);
    }
    expect(JSON.stringify(rows)).not.toContain("price_");
    const refs = await readCatalogBillingRefs();
    expect(refs).toHaveLength(rows.length);
    const bp = refs.find(
      (r) =>
        r.kind === "addon" && r.key === "builder-pro" && r.path === "standard",
    );
    expect(bp).toMatchObject({
      productRef: "prod_builder-pro_standard",
      monthlyRef: "price_builder-pro_standard_month_1200",
      yearlyRef: "price_builder-pro_standard_year_12000",
      onceRef: null,
    });
  });

  it("syncAllPrices fills only missing refs on priced rows, audited once per run", async (ctx) => {
    if (!booted) return ctx.skip();
    await expect(
      syncAllPrices(support, { billing: cannedSpy() }),
    ).rejects.toThrow(Forbidden);
    const pending = await pendingPriceSyncs();
    expect(pending.length).toBeGreaterThan(0);
    // Unpriced rows are never synced (D264).
    expect(
      pending.some((p) => p.key === "credentials" && p.path === "standard"),
    ).toBe(false);

    const spy = cannedSpy();
    const first = await syncAllPrices(admin, { billing: spy });
    expect(first.created).toBe(pending.length);
    expect(first.skipped).toBeGreaterThan(0);
    expect(syncArgs(spy).every((a) => a.previousPriceRef === null)).toBe(true);
    expect(
      syncArgs(spy).some(
        (a) => a.key === "builder-pro" && a.path === "standard",
      ),
    ).toBe(false);
    expect(await pendingPriceSyncs()).toHaveLength(0);
    const tier = (await readCatalogBillingRefs()).find(
      (r) => r.key === "studio-booking-large-team",
    );
    expect(tier?.monthlyRef).toBe(
      "price_studio-booking-large-team_studio_month_17900",
    );
    expect(tier?.yearlyRef).toBe(
      "price_studio-booking-large-team_studio_year_179000",
    );

    const spy2 = cannedSpy();
    const second = await syncAllPrices(admin, { billing: spy2 });
    expect(second.created).toBe(0);
    expect(spy2.callsTo("syncPrice")).toHaveLength(0);

    const pb = await superuser();
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'price_catalog.sync_all'", {}),
      sort: "created",
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]!.meta).toMatchObject({ created: pending.length });
    expect(JSON.stringify(audit[0]!.meta)).not.toContain("price_");
  });
});
