/// <reference path="../pb_data/types.d.ts" />
// ONB-01 / CONTEXT A3-Q1: the services a business offers, entered at intake. Core data read
// by the Services block. price_display decides how price_cents is shown (fixed, from, free,
// ask). All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "services",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "relation",
          name: "organization",
          required: true,
          collectionId: orgs.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "text", name: "name", required: true, max: 120 },
        { type: "text", name: "description", max: 600 },
        {
          type: "select",
          name: "price_display",
          required: true,
          maxSelect: 1,
          values: ["fixed", "from", "free", "ask"],
        },
        { type: "number", name: "price_cents", onlyInt: true, min: 0 },
        { type: "number", name: "duration_minutes", onlyInt: true, min: 0 },
        { type: "number", name: "sort_order", onlyInt: true },
        { type: "bool", name: "is_published" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_services_org_sort ON services (organization, sort_order)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("services"));
  },
);
