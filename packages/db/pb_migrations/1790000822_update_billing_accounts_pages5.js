/// <reference path="../pb_data/types.d.ts" />
// P11 (11-03; D185, DASH-08): the "+5 pages" pack quantity, mirroring media_5gb_qty. 10
// pages are included; each pack adds 5. Integer >= 0 (PB stores 0 when unset).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("billing_accounts");
    col.fields.add(
      new NumberField({ name: "pages_5_qty", onlyInt: true, min: 0 }),
    );
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("billing_accounts");
    col.fields.removeByName("pages_5_qty");
    app.save(col);
  },
);
