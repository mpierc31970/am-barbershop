/// <reference path="../pb_data/types.d.ts" />
// DASH-34, DASH-36 (P11): in-app alerts, one row per person. `source_key` dedupes while the
// row exists (unique per organization + user); it is server-only. `safe_title` is the
// lock-screen text for push when the alert is sensitive. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const collection = new Collection({
      type: "base",
      name: "alerts",
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
        { type: "text", name: "type", required: true, max: 64 },
        {
          type: "select",
          name: "level",
          required: true,
          maxSelect: 1,
          values: ["urgent", "normal", "summary"],
        },
        { type: "text", name: "title", required: true, max: 200 },
        { type: "text", name: "safe_title", max: 200 },
        { type: "text", name: "href", max: 300 },
        { type: "text", name: "section", max: 40 },
        { type: "text", name: "source_key", required: true, max: 160 },
        { type: "date", name: "read_at" },
        { type: "date", name: "pushed_at" },
        { type: "date", name: "emailed_at" },
        {
          type: "select",
          name: "push_state",
          maxSelect: 1,
          values: ["pending", "held", "sent", "skipped", "failed"],
        },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_alerts_org_user_created ON alerts (organization, user, created)",
        "CREATE UNIQUE INDEX idx_alerts_org_user_source ON alerts (organization, user, source_key)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("alerts"));
  },
);
