/// <reference path="../pb_data/types.d.ts" />
// P10 (10-11): the one price catalog becomes the billing source (BILL-18, BILL-02, BILL-10,
// BILL-13, BILL-14; CONTEXT A2; D264). Extended, never replaced:
// - item_kind gains `pack` (monthly: media and page packs, D185, D225), `service` (one-time:
//   design polish hourly rate, D297) and `setup_fee` (one-time: add-on setup, D186).
// - Four text columns hold the provider ids (stripe_product, stripe_price_monthly / _yearly /
//   _once). Platform-only: readPriceCatalog never returns them; readCatalogBillingRefs is
//   server-only. Empty until `prices:set` (or `--sync-all`) calls CdsBilling.syncPrice.
// - Seed rows for standard and studio only (Shop is v1.1, D302). polish-hour stays unpriced
//   (D297 gives a range; never invent a number, D264). Studio Booking tiers are studio-only
//   (D176-D178) and priced per BILL-10; Builder Pro, Newsletter and landing pages are $0 on
//   Studio (D180, D234).
// Idempotent: a seed row whose (kind, key, path) already exists is left alone, so a price set
// before this migration (e.g. by prices:set creating the row) is never overwritten.
// All API rules stay null (invariant 1).
const P6_KINDS = ["plan", "build_fee", "care_plan", "addon", "extra"];
const P10_KINDS = ["pack", "service", "setup_fee"];
const REF_FIELDS = [
  "stripe_product",
  "stripe_price_monthly",
  "stripe_price_yearly",
  "stripe_price_once",
];

const SEED = [
  // kind, key, path, monthly_cents, one_time_cents, priced
  ["pack", "media-5gb", "standard", 500, null, true],
  ["pack", "media-5gb", "studio", 500, null, true],
  ["pack", "media-25gb", "standard", 1500, null, true],
  ["pack", "media-25gb", "studio", 1500, null, true],
  ["pack", "pages-5", "standard", 1000, null, true],
  ["pack", "pages-5", "studio", 1000, null, true],
  ["service", "polish-hour", "standard", null, null, false],
  ["service", "polish-hour", "studio", null, null, false],
  ["setup_fee", "addon", "standard", null, 2500, true],
  ["setup_fee", "addon", "studio", null, 2500, true],
  ["addon", "builder-pro", "standard", 1200, null, true],
  ["addon", "builder-pro", "studio", 0, null, true],
  ["addon", "studio-booking-solo", "studio", 4900, null, true],
  ["addon", "studio-booking-team", "studio", 9900, null, true],
  ["addon", "studio-booking-large-team", "studio", 17900, null, true],
  ["addon", "newsletter", "studio", 0, null, true],
  ["addon", "landing-pages", "studio", 0, null, true],
];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("price_catalog");
    col.fields.getByName("item_kind").values = [...P6_KINDS, ...P10_KINDS];
    for (const name of REF_FIELDS) {
      col.fields.add(new TextField({ name, max: 255 }));
    }
    app.save(col);

    for (const [kind, key, path, monthly, oneTime, priced] of SEED) {
      let exists = false;
      try {
        app.findFirstRecordByFilter(
          "price_catalog",
          "item_kind = {:kind} && item_key = {:key} && path = {:path}",
          { kind, key, path },
        );
        exists = true;
      } catch (_) {
        exists = false;
      }
      if (exists) continue;
      const record = new Record(col);
      record.set("item_kind", kind);
      record.set("item_key", key);
      record.set("path", path);
      if (monthly !== null) record.set("monthly_cents", monthly);
      if (oneTime !== null) record.set("one_time_cents", oneTime);
      record.set("priced", priced);
      record.set("active", true);
      app.save(record);
    }
  },
  (app) => {
    // Rows first: every row on a new kind (seeded or set later), then the P10 addon seeds,
    // so the down never strands a row on a value the select no longer has.
    app
      .db()
      .newQuery(
        "DELETE FROM price_catalog WHERE item_kind IN ('pack', 'service', 'setup_fee')",
      )
      .execute();
    for (const [kind, key, path] of SEED) {
      if (P10_KINDS.includes(kind)) continue;
      app
        .db()
        .newQuery(
          "DELETE FROM price_catalog WHERE item_kind = {:kind} AND item_key = {:key} AND path = {:path}",
        )
        .bind({ kind, key, path })
        .execute();
    }
    const col = app.findCollectionByNameOrId("price_catalog");
    for (const name of REF_FIELDS) col.fields.removeByName(name);
    col.fields.getByName("item_kind").values = P6_KINDS;
    app.save(col);
  },
);
