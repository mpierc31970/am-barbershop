/// <reference path="../pb_data/types.d.ts" />
// DASH-22, DASH-23 (P11): one row per person per site holding their Today layout, tours seen,
// alert channels, quiet hours, dismissed cards and seen flags. Unique (organization, user).
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const collection = new Collection({
      type: "base",
      name: "member_prefs",
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
          name: "user",
          required: true,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "json", name: "today_layout" },
        { type: "json", name: "tours_seen" },
        { type: "json", name: "alert_channels" },
        { type: "json", name: "quiet_hours" },
        { type: "json", name: "dismissed" },
        { type: "json", name: "seen_flags" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_member_prefs_org_user ON member_prefs (organization, user)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("member_prefs"));
  },
);
