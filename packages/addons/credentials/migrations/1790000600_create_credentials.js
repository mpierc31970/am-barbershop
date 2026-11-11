// ADDON-03 / invariant 3: the credentials collection ships in the schema from day one and
// sits empty until the Credentials add-on is on. All API rules null (invariant 1): every
// read and write goes through the @cds/db chokepoint (addonRepo, readPublicAddonRecords).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "credentials",
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
        { type: "text", name: "title", required: true, max: 160 },
        { type: "text", name: "issuer", required: true, max: 160 },
        { type: "text", name: "category", max: 60 },
        { type: "text", name: "credential_number", max: 80 },
        { type: "bool", name: "show_number" },
        { type: "date", name: "issued_on" },
        { type: "date", name: "expires_on" },
        { type: "text", name: "verify_url", max: 2000 },
        { type: "bool", name: "is_published" },
        { type: "number", name: "sort_order" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_credentials_org_sort ON credentials (organization, sort_order)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("credentials"));
  },
);
