/// <reference path="../pb_data/types.d.ts" />
// DASH-14 (P11): a site's social accounts, ordered, each with a short code for tracked
// links (/s/<code>). `platform` is a preset key or "custom". Unique (organization,
// short_code). All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "social_accounts",
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
        { type: "text", name: "platform", required: true, max: 24 },
        { type: "text", name: "label", max: 60 },
        { type: "text", name: "url", required: true, max: 500 },
        { type: "text", name: "short_code", required: true, max: 24 },
        { type: "number", name: "order", onlyInt: true, min: 0 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_social_accounts_org_code ON social_accounts (organization, short_code)",
        'CREATE INDEX idx_social_accounts_org_order ON social_accounts (organization, "order")',
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("social_accounts"));
  },
);
