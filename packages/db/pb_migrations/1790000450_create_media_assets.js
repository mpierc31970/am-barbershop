/// <reference path="../pb_data/types.d.ts" />
// ONB-04 / CONTEXT A4-Q1 / D255, D280: one row per uploaded image (logo, hero, gallery, team,
// moodboard). The bytes live in object storage under `storage_dir` (a path, not a secret);
// this row holds the metadata. `removed_at` soft-removes. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "media_assets",
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
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["logo", "hero", "gallery", "team", "moodboard"],
        },
        { type: "text", name: "storage_dir", required: true, max: 200 },
        {
          type: "select",
          name: "original_ext",
          maxSelect: 1,
          values: ["jpg", "png", "webp"],
        },
        { type: "number", name: "width", onlyInt: true, min: 0 },
        { type: "number", name: "height", onlyInt: true, min: 0 },
        { type: "number", name: "web_width", onlyInt: true, min: 0 },
        { type: "number", name: "web_height", onlyInt: true, min: 0 },
        { type: "number", name: "bytes", onlyInt: true, min: 0 },
        { type: "text", name: "mime", max: 40 },
        { type: "text", name: "alt", max: 250 },
        { type: "select", name: "source", maxSelect: 1, values: ["intake"] },
        { type: "number", name: "sort_order", onlyInt: true },
        { type: "date", name: "removed_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_media_assets_org_kind_sort ON media_assets (organization, kind, sort_order)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("media_assets"));
  },
);
