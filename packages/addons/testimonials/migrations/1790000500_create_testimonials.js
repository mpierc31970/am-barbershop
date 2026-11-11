// ADDON-03 / invariant 3: the testimonials collection ships in the schema from day one and
// sits empty until the Testimonials add-on is on. All API rules null (invariant 1): every
// read and write goes through the @cds/db chokepoint (addonRepo, readPublicAddonRecords).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "testimonials",
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
        { type: "text", name: "quote", required: true, max: 1000 },
        { type: "text", name: "author_name", required: true, max: 120 },
        { type: "text", name: "author_detail", max: 160 },
        { type: "number", name: "rating", min: 1, max: 5, onlyInt: true },
        { type: "text", name: "photo_url", max: 2000 },
        { type: "text", name: "photo_alt", max: 250 },
        {
          type: "select",
          name: "source",
          maxSelect: 1,
          values: ["manual", "import", "google"],
        },
        { type: "bool", name: "featured" },
        { type: "bool", name: "is_published" },
        { type: "number", name: "sort_order" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_testimonials_org_sort ON testimonials (organization, sort_order)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("testimonials"));
  },
);
