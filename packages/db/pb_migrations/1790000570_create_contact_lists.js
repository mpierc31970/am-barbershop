/// <reference path="../pb_data/types.d.ts" />
// CONTACTS-02, D266: contact lists decide who sees a contact. One `house` list per org (the
// owner's; partial unique index) and one `renter` list per renter membership
// (`owner_member`). Nothing here is secret. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const memberships = app.findCollectionByNameOrId("memberships");
    const collection = new Collection({
      type: "base",
      name: "contact_lists",
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
        { type: "text", name: "name", required: true, max: 80 },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["house", "renter"],
        },
        {
          type: "relation",
          name: "owner_member",
          required: false,
          collectionId: memberships.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_contact_lists_org ON contact_lists (organization)",
        "CREATE UNIQUE INDEX idx_contact_lists_org_house ON contact_lists (organization) WHERE kind = 'house'",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("contact_lists"));
  },
);
