/// <reference path="../pb_data/types.d.ts" />
// TEN-01 / D5: organizations is the tenant root. Every tenant-scoped collection relates to it.
// `design` holds the per-org impeccable design tokens (D8, invariant 8).
// All API rules null (superuser only): tenant isolation lives in the @cds/db chokepoint.
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "organizations",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "name", required: true },
        { type: "text", name: "slug", required: true },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["active", "held", "disabled"],
        },
        { type: "json", name: "design" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_organizations_slug ON organizations (slug)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("organizations"));
  },
);
