/// <reference path="../pb_data/types.d.ts" />
// BILL-16 (review WR-D04): what each subscription item is billed at, mirrored from the
// provider's subscription by the webhook and reconcile handlers (`syncItemsToAccount`).
// [{ kind, key, interval, unitCents, quantity }]: integer cents per unit per interval,
// no provider ids. The Billing tab renders amounts from this mirror, so a price-locked owner
// (D161: existing subscriptions keep their old price) sees what they actually pay, not the
// live catalog. Empty until the next sync; the tab falls back to the catalog meanwhile.
// API rules stay null (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("billing_accounts");
    col.fields.add(new JSONField({ name: "item_prices", maxSize: 20000 }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("billing_accounts");
    col.fields.removeByName("item_prices");
    app.save(col);
  },
);
