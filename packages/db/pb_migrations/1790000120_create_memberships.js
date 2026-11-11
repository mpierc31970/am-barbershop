/// <reference path="../pb_data/types.d.ts" />
// TEN-09 / D286: memberships joins users to organizations with a role. A user owns at most
// one organization (partial unique index, race-proof in SQLite) but may hold staff/renter
// or other roles in further orgs. One row per (user, organization).
// All API rules null (superuser only).
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "memberships",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "relation",
          name: "user",
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
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
          name: "role",
          required: true,
          maxSelect: 1,
          values: ["owner", "admin", "editor", "viewer", "staff", "renter"],
        },
        { type: "json", name: "addon_grants" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_memberships_user_org ON memberships (user, organization)",
        "CREATE UNIQUE INDEX idx_memberships_one_owner ON memberships (user) WHERE role = 'owner'",
        "CREATE INDEX idx_memberships_org ON memberships (organization)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("memberships"));
  },
);
