/// <reference path="../pb_data/types.d.ts" />
// COMM-11 (P12): notes CDS leaves for a site ("Notes from CDS"). pinned notes sort first;
// removed_at is a soft remove. created_by is the staff id (serverOnly in BROWSER_FIELDS);
// author_name is the display name shown to the owner. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "cds_notes",
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
        { type: "text", name: "title", max: 80 },
        { type: "text", name: "body", max: 5000 },
        { type: "bool", name: "pinned" },
        { type: "text", name: "created_by", max: 40 },
        { type: "text", name: "author_name", max: 60 },
        { type: "date", name: "removed_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_cds_notes_org_pinned ON cds_notes (organization, pinned, created)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("cds_notes"));
  },
);
