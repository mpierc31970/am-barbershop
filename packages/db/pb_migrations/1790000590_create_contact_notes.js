/// <reference path="../pb_data/types.d.ts" />
// CONTACTS-02, D266: private notes on a contact, per list (a renter's notes are never seen
// by the house list and vice versa). Nothing here is secret. All API rules null
// (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const contacts = app.findCollectionByNameOrId("contacts");
    const lists = app.findCollectionByNameOrId("contact_lists");
    const users = app.findCollectionByNameOrId("users");
    const collection = new Collection({
      type: "base",
      name: "contact_notes",
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
          name: "contact",
          required: true,
          collectionId: contacts.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "relation",
          name: "list",
          required: true,
          collectionId: lists.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "text", name: "body", required: true, max: 5000 },
        {
          type: "relation",
          name: "author",
          required: false,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_contact_notes_org_contact_list ON contact_notes (organization, contact, list)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("contact_notes"));
  },
);
