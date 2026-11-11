/// <reference path="../pb_data/types.d.ts" />
// DASH-11 (P11): invites to join a site's team. Only the sha256 of the invite token is
// stored (`token_hash`, server-only, unique). Roles mirror memberships minus owner.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const collection = new Collection({
      type: "base",
      name: "member_invites",
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
        { type: "email", name: "email", required: true },
        {
          type: "select",
          name: "role",
          required: true,
          maxSelect: 1,
          values: ["admin", "editor", "viewer", "staff", "renter"],
        },
        { type: "json", name: "grants" },
        { type: "text", name: "token_hash", required: true, max: 64 },
        { type: "date", name: "expires_at", required: true },
        {
          type: "relation",
          name: "invited_by",
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["pending", "accepted", "revoked", "expired"],
        },
        {
          type: "relation",
          name: "accepted_by",
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_member_invites_org_email_status ON member_invites (organization, email, status)",
        "CREATE UNIQUE INDEX idx_member_invites_token_hash ON member_invites (token_hash)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("member_invites"));
  },
);
