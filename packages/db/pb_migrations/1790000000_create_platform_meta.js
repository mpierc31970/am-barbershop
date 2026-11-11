/// <reference path="../pb_data/types.d.ts" />
// D5: one shared PocketBase. platform_meta holds platform-level key/value settings.
// Every API rule is null, so only superusers can read or write it.
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "platform_meta",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "key", required: true },
        { type: "text", name: "value" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_platform_meta_key ON platform_meta (key)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("platform_meta"));
  },
);
