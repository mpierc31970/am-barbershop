/// <reference path="../pb_data/types.d.ts" />
// COMM-11, COMM-06 (P12): documents CDS shares with a site (Documents list). The storage key
// is named object_key (never "key", RESEARCH Pitfall 7); object_key and shared_by (staff id)
// are serverOnly in BROWSER_FIELDS. removed_at is a soft remove.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "cds_documents",
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
        { type: "text", name: "title", max: 120 },
        { type: "text", name: "note", max: 500 },
        { type: "text", name: "object_key", max: 400 },
        { type: "text", name: "filename", max: 200 },
        { type: "number", name: "size", onlyInt: true, min: 0 },
        { type: "text", name: "mime", max: 100 },
        { type: "text", name: "ext", max: 8 },
        { type: "text", name: "shared_by", max: 40 },
        { type: "text", name: "author_name", max: 60 },
        { type: "date", name: "removed_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_cds_documents_org_created ON cds_documents (organization, created)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("cds_documents"));
  },
);
