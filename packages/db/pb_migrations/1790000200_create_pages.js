/// <reference path="../pb_data/types.d.ts" />
// CONT-30 / D254 / CONTEXT A1-Q3: one pages collection with one draft -> publish flow.
// slug is unique per organization; previous_slugs keeps old slugs for redirects. password_hash
// is hidden and never exported, filtered or served (T-03-08). `held` = moderation hold (D248).
// kind is "builder" only in v1.0. All API rules null (superuser only; isolation lives in
// @cds/db, invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "pages",
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
        { type: "text", name: "slug", required: true, max: 64 },
        { type: "text", name: "title", required: true, max: 120 },
        { type: "json", name: "seo" },
        { type: "text", name: "password_hash", hidden: true },
        { type: "bool", name: "password_protected" },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["draft", "published", "held"],
        },
        { type: "date", name: "published_at" },
        { type: "bool", name: "has_unpublished_changes" },
        { type: "json", name: "previous_slugs" },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["builder"],
        },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_pages_org_slug ON pages (organization, slug)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("pages"));
  },
);
