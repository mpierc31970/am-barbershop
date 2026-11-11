// Price catalog chokepoint (ONB-06; CONTEXT A2-Q1, A2-Q2; D181, D264, D299, D300; PD-5).
// price_catalog is a platform collection (no organization field): every /start visitor's
// quote reads it, so readPriceCatalog takes NO context. It is public, non-tenant data (the
// same prices for everyone) and returns no ids or notes. setPrice is the only write: a
// super_admin (prices_set) through the staff CLI, audited with before/after (T-06-14, T-06-18).
//
// PB number fields store 0 for "empty", so `priced` is the flag that tells "Price coming
// soon" from $0 (PD-5). Each kind prices one dimension: plan, care_plan, addon and pack are
// monthly; build_fee, extra, service and setup_fee are one-time. The other dimension is
// always null, and setting it is refused rather than silently ignored.
//
// P10 (10-11; BILL-18, D161, D264): the catalog is also the billing source. The provider
// price ids (stripe_product, stripe_price_monthly / _yearly / _once) are server-only:
// readPriceCatalog never returns them; readCatalogBillingRefs does, for checkout and charges.
// setPrice calls CdsBilling.syncPrice when an amount changes: a new provider price is created
// and the old one archived, so existing subscriptions keep their price (founding lock, D161).
// Provider price mapping (10-11 choice 1): plan and addon → month + year (10 x monthly,
// D314); care_plan and pack → month; build_fee → once (pay in full) + month (the
// installment, installmentSplit(build).eachCents); extra, service and setup_fee → once.
import { authorizeStaff, InvalidInput } from "@cds/core";
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import {
  installmentSplit,
  type CdsBilling,
  type Interval,
} from "@cds/core/payments";
import type { CatalogItemKind, CatalogRow } from "@cds/core/pricing";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "./audit";
import { withSuperuser } from "./client";
import { assertPlatformContext, type PlatformContext } from "./context";
import { INSTALLMENT_KEY } from "./payments/accounts";
import { getCdsBilling } from "./payments/factory";
import { newRecordId } from "./repository";

const COLLECTION = "price_catalog";
const KINDS: readonly CatalogItemKind[] = [
  "plan",
  "build_fee",
  "care_plan",
  "addon",
  "extra",
  "pack",
  "service",
  "setup_fee",
];
const MONTHLY_KINDS: readonly CatalogItemKind[] = [
  "plan",
  "care_plan",
  "addon",
  "pack",
];
const KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** $100,000.00: far above any real price, low enough to catch a dollars-for-cents slip. */
const MAX_CENTS = 10_000_000;
/** Yearly = 10 x monthly ("2 months free", D314), the same factor priceQuote uses. */
const YEARLY_MONTHS = 10;
const REF_COLUMNS = {
  month: "stripe_price_monthly",
  year: "stripe_price_yearly",
  once: "stripe_price_once",
} as const satisfies Record<Interval, string>;
type RefColumn = (typeof REF_COLUMNS)[Interval];

export type SetPriceInput = {
  kind: CatalogItemKind;
  key: string;
  path: AddonPath;
  monthlyCents?: number | null;
  oneTimeCents?: number | null;
};

export type CatalogDeps = { billing?: CdsBilling };

function isMonthly(kind: CatalogItemKind): boolean {
  return MONTHLY_KINDS.includes(kind);
}

function toRow(r: RecordModel): CatalogRow {
  const kind = r.item_kind as CatalogItemKind;
  const priced = r.priced === true;
  const monthly = priced && isMonthly(kind) ? Number(r.monthly_cents) : null;
  const oneTime = priced && !isMonthly(kind) ? Number(r.one_time_cents) : null;
  const n = Number(r.installments);
  return {
    itemKind: kind,
    itemKey: String(r.item_key),
    path: r.path as AddonPath,
    monthlyCents: monthly,
    oneTimeCents: oneTime,
    installments:
      kind === "build_fee" && Number.isSafeInteger(n) && n >= 1 ? n : null,
  };
}

function rowCents(row: CatalogRow): number | null {
  return isMonthly(row.itemKind) ? row.monthlyCents : row.oneTimeCents;
}

async function readActiveRecords(): Promise<RecordModel[]> {
  return withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({
      filter: pb.filter("active = {:active}", { active: true }),
      sort: "item_kind,item_key,path",
    }),
  );
}

/**
 * Every active catalog row. Unpriced rows carry null cents, never 0 (D264). Public-safe:
 * no record ids and no provider price ids (T-10-11-03).
 */
export async function readPriceCatalog(): Promise<CatalogRow[]> {
  return (await readActiveRecords()).map(toRow);
}

function validCents(v: number | null, name: string): number | null {
  if (v === null) return null;
  if (
    typeof v !== "number" ||
    !Number.isSafeInteger(v) ||
    v < 0 ||
    v > MAX_CENTS
  ) {
    throw new InvalidInput(
      `${name} must be whole cents from 0 to ${MAX_CENTS}`,
    );
  }
  return v;
}

/** D176-D178 (review WR-A03): Studio Booking is never offered on the Standard path. */
function refuseStudioOnly(
  kind: CatalogItemKind,
  key: string,
  path: AddonPath,
): void {
  if (
    kind === "addon" &&
    key.startsWith("studio-booking") &&
    path !== "studio"
  ) {
    throw new InvalidInput("Studio Booking is priced on the Studio path only");
  }
}

function validate(input: SetPriceInput): {
  kind: CatalogItemKind;
  key: string;
  path: AddonPath;
  cents: number | null;
} {
  if (!input || typeof input !== "object") {
    throw new InvalidInput("price input is required");
  }
  const { kind, key, path } = input;
  if (!KINDS.includes(kind)) throw new InvalidInput("unknown catalog kind");
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    throw new InvalidInput("catalog key must be a lowercase slug");
  }
  if (!(ADDON_PATHS as readonly string[]).includes(path)) {
    throw new InvalidInput("unknown path");
  }
  refuseStudioOnly(kind, key, path);
  const monthly = isMonthly(kind);
  const field = monthly ? "monthlyCents" : "oneTimeCents";
  const other = monthly ? input.oneTimeCents : input.monthlyCents;
  if (other !== undefined && other !== null) {
    throw new InvalidInput(
      `${kind} is priced ${monthly ? "monthly" : "one-time"}; set ${field}`,
    );
  }
  const raw = monthly ? input.monthlyCents : input.oneTimeCents;
  if (raw === undefined) {
    throw new InvalidInput(`${field} is required (null marks it unpriced)`);
  }
  return { kind, key, path, cents: validCents(raw, field) };
}

// ---------------------------------------------------------------------------------------
// Provider price sync (BILL-18, D161)

/**
 * One provider price a priced row needs (10-11 choice 1). `kind` / `key` override the row's
 * identity in the price metadata (CR-E01: the build fee's monthly price is the installment).
 */
type SyncTarget = {
  interval: Interval;
  cents: number;
  column: RefColumn;
  kind?: string;
  key?: string;
};

function syncTargets(
  kind: CatalogItemKind,
  cents: number,
  installments: number | null,
): SyncTarget[] {
  const t = (interval: Interval, c: number): SyncTarget => ({
    interval,
    cents: c,
    column: REF_COLUMNS[interval],
  });
  switch (kind) {
    case "plan":
    case "addon":
      return [t("month", cents), t("year", YEARLY_MONTHS * cents)];
    case "care_plan":
    case "pack":
      return [t("month", cents)];
    case "build_fee": {
      const n = installments !== null && installments >= 1 ? installments : 1;
      // CR-E01: Stripe reads a Checkout-created item's kind from its price, so the monthly
      // price must say it is the installment, not the build fee.
      return [
        t("once", cents),
        {
          ...t("month", installmentSplit(cents, n).eachCents),
          kind: "installment",
          key: INSTALLMENT_KEY,
        },
      ];
    }
    case "extra":
    case "service":
    case "setup_fee":
      return [t("once", cents)];
  }
}

function refOf(r: RecordModel | null, column: string): string | null {
  const v = r?.[column];
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * Create the provider prices for one row and return the ref columns to write.
 * `missingOnly` skips intervals that already have a ref (sync-all).
 */
async function syncRow(
  billing: CdsBilling,
  row: { kind: CatalogItemKind; key: string; path: string },
  existing: RecordModel | null,
  targets: readonly SyncTarget[],
  missingOnly: boolean,
): Promise<{ refs: Record<string, string>; created: number; skipped: number }> {
  let productRef = refOf(existing, "stripe_product");
  const refs: Record<string, string> = {};
  let created = 0;
  let skipped = 0;
  for (const target of targets) {
    const previousPriceRef = refOf(existing, target.column);
    if (missingOnly && previousPriceRef !== null) {
      skipped += 1;
      continue;
    }
    const out = await billing.syncPrice({
      kind: target.kind ?? row.kind,
      key: target.key ?? row.key,
      path: row.path,
      interval: target.interval,
      cents: target.cents,
      productRef,
      previousPriceRef,
    });
    productRef = out.productRef;
    refs[target.column] = out.priceRef;
    created += 1;
  }
  if (created > 0 && productRef !== null) refs.stripe_product = productRef;
  return { refs, created, skipped };
}

/**
 * Set (or clear, with null) one catalog price. super_admin only (prices_set, CONTEXT A2-Q2);
 * creates the row when missing (a new add-on). Audited as price_catalog.set with before/after,
 * in the same PB batch as the price write. When the amount changes to a non-null value the
 * provider prices are synced first (new prices, the old ones archived; D161) and their ids are
 * written in that same batch. The audit meta never carries the ids. `null` (unpriced) and an
 * unchanged amount make no provider call and leave the refs as they were.
 */
export async function setPrice(
  ctx: PlatformContext,
  input: SetPriceInput,
  deps: CatalogDeps = {},
): Promise<{
  before: CatalogRow | null;
  after: CatalogRow;
  /** Provider prices created (0 when unchanged or unpriced). */
  synced: number;
}> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "prices_set");
  const { kind, key, path, cents } = validate(input);
  const column = isMonthly(kind) ? "monthly_cents" : "one_time_cents";
  const values = { [column]: cents ?? 0, priced: cents !== null };

  return withSuperuser(async (pb) => {
    let existing: RecordModel | null;
    try {
      existing = await pb.collection(COLLECTION).getFirstListItem(
        pb.filter(
          "item_kind = {:kind} && item_key = {:key} && path = {:path}",
          {
            kind,
            key,
            path,
          },
        ),
      );
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        existing = null;
      } else {
        throw err;
      }
    }
    const before = existing ? toRow(existing) : null;
    const beforeCents = before ? rowCents(before) : null;

    // T-10-11-02 / D161: a changed amount is a NEW provider price; subscriptions on the old
    // price keep it. Synced before the batch so the ids land with the price and its audit.
    let refs: Record<string, string> = {};
    let synced = 0;
    if (cents !== null && cents !== beforeCents) {
      const result = await syncRow(
        deps.billing ?? getCdsBilling(),
        { kind, key, path },
        existing,
        syncTargets(kind, cents, before?.installments ?? null),
        false,
      );
      refs = result.refs;
      synced = result.created;
    }

    // A-WR-09: the price and its audit row commit together in one PB batch, so a price
    // every visitor sees never changes without its before/after record.
    const id = existing?.id ?? newRecordId();
    const priceBody = existing
      ? values
      : { item_kind: kind, item_key: key, path, active: true, ...values };
    const after = toRow({
      ...(existing ?? {}),
      ...priceBody,
      id,
    } as RecordModel);
    const body = { ...priceBody, ...refs };
    const batch = pb.createBatch();
    if (existing) batch.collection(COLLECTION).update(id, body);
    else batch.collection(COLLECTION).create({ ...body, id });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "price_catalog.set",
        organization: null,
        targetCollection: COLLECTION,
        targetId: id,
        meta: {
          kind,
          key,
          path,
          before,
          after,
          providerPricesCreated: synced,
        },
      }),
    );
    await batch.send();
    return { before, after, synced };
  });
}

export type PriceCase = {
  /** The row's current price; null when the row is missing, unpriced or inactive. */
  currentCents: number | null;
  /** Organizations on this path (every one of them gets a $0 add-on, WR-A02 rules). */
  pathOrgs: number;
};

/**
 * Read-only case prices:set prints before it saves (review WR-A03): a $0 active `addon` row
 * is plan-included, an entitlement for every org on the path, so going to or from $0 grants
 * or revokes it for all of them at once. super_admin only (prices_set), like setPrice.
 */
export async function priceCase(
  ctx: PlatformContext,
  input: { kind: CatalogItemKind; key: string; path: AddonPath },
): Promise<PriceCase> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "prices_set");
  const { kind, key, path } = input;
  if (!KINDS.includes(kind)) throw new InvalidInput("unknown catalog kind");
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    throw new InvalidInput("catalog key must be a lowercase slug");
  }
  if (!(ADDON_PATHS as readonly string[]).includes(path)) {
    throw new InvalidInput("unknown path");
  }
  return withSuperuser(async (pb) => {
    let currentCents: number | null = null;
    try {
      const row = await pb
        .collection(COLLECTION)
        .getFirstListItem(
          pb.filter(
            "item_kind = {:kind} && item_key = {:key} && path = {:path}",
            { kind, key, path },
          ),
        );
      if (row.active === true) currentCents = rowCents(toRow(row));
    } catch (err) {
      if (!(err instanceof ClientResponseError && err.status === 404)) {
        throw err;
      }
    }
    const orgs = await pb.collection("organizations").getList(1, 1, {
      filter: pb.filter("path = {:path}", { path }),
      fields: "id",
    });
    return { currentCents, pathOrgs: orgs.totalItems };
  });
}

/** Server-only provider refs for one catalog row (T-10-11-03: never sent to a browser). */
export type CatalogBillingRef = {
  kind: CatalogItemKind;
  key: string;
  path: AddonPath;
  productRef: string | null;
  monthlyRef: string | null;
  yearlyRef: string | null;
  onceRef: string | null;
};

/**
 * The provider ids for every active row, for checkout and charges. SERVER-ONLY: never pass
 * this to a client component or an API response (readPriceCatalog is the public read).
 */
export async function readCatalogBillingRefs(): Promise<CatalogBillingRef[]> {
  return (await readActiveRecords()).map((r) => ({
    kind: r.item_kind as CatalogItemKind,
    key: String(r.item_key),
    path: r.path as AddonPath,
    productRef: refOf(r, "stripe_product"),
    monthlyRef: refOf(r, REF_COLUMNS.month),
    yearlyRef: refOf(r, REF_COLUMNS.year),
    onceRef: refOf(r, REF_COLUMNS.once),
  }));
}

/** One provider price `--sync-all` would create. */
export type PendingPriceSync = {
  kind: CatalogItemKind;
  key: string;
  path: AddonPath;
  interval: Interval;
  cents: number;
};

/** The provider prices `prices:set --sync-all` would create (its --dry-run). */
export async function pendingPriceSyncs(): Promise<PendingPriceSync[]> {
  return (await readActiveRecords()).flatMap((r) => {
    const row = toRow(r);
    const cents = rowCents(row);
    if (cents === null) return [];
    return syncTargets(row.itemKind, cents, row.installments)
      .filter((t) => refOf(r, t.column) === null)
      .map((t) => ({
        kind: row.itemKind,
        key: row.itemKey,
        path: row.path,
        interval: t.interval,
        cents: t.cents,
      }));
  });
}

/**
 * Create provider prices for every priced row missing them (required once when
 * CDS_PAYMENTS switches to stripe). super_admin only (prices_set); unpriced rows are never
 * synced. The ref writes and one `price_catalog.sync_all` audit row commit in one batch.
 */
export async function syncAllPrices(
  ctx: PlatformContext,
  deps: CatalogDeps = {},
): Promise<{ created: number; skipped: number }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "prices_set");
  const billing = deps.billing ?? getCdsBilling();
  const records = await readActiveRecords();
  const updates: { id: string; refs: Record<string, string> }[] = [];
  let created = 0;
  let skipped = 0;
  for (const r of records) {
    const row = toRow(r);
    const cents = rowCents(row);
    if (cents === null) continue;
    const result = await syncRow(
      billing,
      { kind: row.itemKind, key: row.itemKey, path: row.path },
      r,
      syncTargets(row.itemKind, cents, row.installments),
      true,
    );
    created += result.created;
    skipped += result.skipped;
    if (result.created > 0) updates.push({ id: r.id, refs: result.refs });
  }
  await withSuperuser(async (pb) => {
    const batch = pb.createBatch();
    for (const u of updates) batch.collection(COLLECTION).update(u.id, u.refs);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "price_catalog.sync_all",
        organization: null,
        targetCollection: COLLECTION,
        meta: { created, skipped, rows: updates.length },
      }),
    );
    await batch.send();
  });
  return { created, skipped };
}
