/// <reference path="../pb_data/types.d.ts" />
// LIFE-04 (P11): "Download my data" requests. `object_key` (the storage key of the built
// zip) is server-only; the browser gets a signed link instead. All API rules null
// (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const collection = new Collection({
      type: "base",
      name: "data_exports",
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
          type: "relation",
          name: "requested_by",
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["queued", "building", "ready", "failed", "expired"],
        },
        { type: "text", name: "object_key", max: 500 },
        { type: "number", name: "size_bytes", onlyInt: true, min: 0 },
        { type: "date", name: "requested_at", required: true },
        { type: "date", name: "ready_at" },
        { type: "date", name: "expires_at" },
        { type: "text", name: "error_kind", max: 60 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_data_exports_org_requested ON data_exports (organization, requested_at)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("data_exports"));
  },
);
