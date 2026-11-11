/// <reference path="../pb_data/types.d.ts" />
// ONB-06 / D181, D264, D299, D300: the one price catalog. A platform collection (no
// organization field): every visitor's quote reads it, only a super_admin writes it
// (setPrice in @cds/db, audited). All API rules null (invariant 1).
// PD-5: PB number fields store 0 for "empty", so `priced` is the explicit flag that tells
// "Price coming soon" (priced=false) apart from a real $0.
// The seed holds only settled prices: plan $39 / $49, build fee $1,500 / $3,500 in up to 6
// installments, Care Plan $99 on both paths. Testimonials, Credentials and the four extras
// stay unpriced until the user sets them (gap B7, CONTEXT A2-Q1): `prices:set`.
const SEED = [
  // kind, key, path, monthly_cents, one_time_cents, installments, priced
  ["plan", "base", "standard", 3900, null, null, true],
  ["plan", "base", "studio", 4900, null, null, true],
  ["build_fee", "base", "standard", null, 150000, 6, true],
  ["build_fee", "base", "studio", null, 350000, 6, true],
  ["care_plan", "care", "standard", 9900, null, null, true],
  ["care_plan", "care", "studio", 9900, null, null, true],
  ["addon", "testimonials", "standard", null, null, null, false],
  ["addon", "testimonials", "studio", null, null, null, false],
  ["addon", "credentials", "standard", null, null, null, false],
  ["addon", "credentials", "studio", null, null, null, false],
  ["extra", "copywriting", "standard", null, null, null, false],
  ["extra", "copywriting", "studio", null, null, null, false],
  ["extra", "logo-design", "standard", null, null, null, false],
  ["extra", "logo-design", "studio", null, null, null, false],
  ["extra", "sourced-photos", "standard", null, null, null, false],
  ["extra", "sourced-photos", "studio", null, null, null, false],
  ["extra", "rush-launch", "standard", null, null, null, false],
  ["extra", "rush-launch", "studio", null, null, null, false],
];

migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "price_catalog",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "select",
          name: "item_kind",
          required: true,
          maxSelect: 1,
          values: ["plan", "build_fee", "care_plan", "addon", "extra"],
        },
        { type: "text", name: "item_key", required: true, max: 40 },
        {
          type: "select",
          name: "path",
          required: true,
          maxSelect: 1,
          values: ["standard", "studio", "shop"],
        },
        { type: "number", name: "monthly_cents", onlyInt: true, min: 0 },
        { type: "number", name: "one_time_cents", onlyInt: true, min: 0 },
        { type: "bool", name: "priced" },
        {
          type: "number",
          name: "installments",
          onlyInt: true,
          min: 1,
          max: 12,
        },
        { type: "bool", name: "active" },
        { type: "text", name: "note", max: 200 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_price_catalog_item ON price_catalog (item_kind, item_key, path)",
      ],
    });
    app.save(collection);

    for (const [
      kind,
      key,
      path,
      monthly,
      oneTime,
      installments,
      priced,
    ] of SEED) {
      const record = new Record(collection);
      record.set("item_kind", kind);
      record.set("item_key", key);
      record.set("path", path);
      if (monthly !== null) record.set("monthly_cents", monthly);
      if (oneTime !== null) record.set("one_time_cents", oneTime);
      if (installments !== null) record.set("installments", installments);
      record.set("priced", priced);
      record.set("active", true);
      app.save(record);
    }
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("price_catalog"));
  },
);
