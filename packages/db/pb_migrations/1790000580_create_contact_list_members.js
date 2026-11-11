/// <reference path="../pb_data/types.d.ts" />
// CONTACTS-02, D266: which lists a contact is on. A contact is on a list at most once
// (unique (list, contact)). Nothing here is secret. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const lists = app.findCollectionByNameOrId("contact_lists");
    const contacts = app.findCollectionByNameOrId("contacts");
    const collection = new Collection({
      type: "base",
      name: "contact_list_members",
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
          name: "list",
          required: true,
          collectionId: lists.id,
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
        { type: "date", name: "added_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_clm_list_contact ON contact_list_members (list, contact)",
        "CREATE INDEX idx_clm_org_contact ON contact_list_members (organization, contact)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("contact_list_members"));
  },
);
