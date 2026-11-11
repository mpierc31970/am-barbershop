/// <reference path="../pb_data/types.d.ts" />
// ADDON-05 / CONTEXT A2-Q1: org_addons is the per-org entitlement row for one add-on. Status
// active|disabled; uninstall and billing lapse disable and retain (invariant 9), never delete.
// One row per (organization, addon). All API rules null (invariant 1): writes are superuser
// only, through the add-on installer chokepoint.
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "org_addons",
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
        {
          type: "text",
          name: "addon",
          required: true,
          max: 40,
          pattern: "^[a-z][a-z0-9-]{1,39}$",
        },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["active", "disabled"],
        },
        {
          type: "select",
          name: "disabled_reason",
          maxSelect: 1,
          values: ["uninstalled", "billing_lapse", "staff"],
        },
        {
          type: "select",
          name: "source",
          required: true,
          maxSelect: 1,
          values: ["hub", "staff", "assembly", "billing"],
        },
        { type: "text", name: "installed_version", max: 32 },
        { type: "json", name: "seeded", maxSize: 20000 },
        { type: "json", name: "settings", maxSize: 20000 },
        { type: "date", name: "installed_at" },
        { type: "date", name: "disabled_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_org_addons_org_addon ON org_addons (organization, addon)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("org_addons"));
  },
);
