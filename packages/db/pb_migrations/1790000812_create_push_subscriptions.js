/// <reference path="../pb_data/types.d.ts" />
// DASH-36 (P11): Web Push subscriptions, one row per person per device endpoint. The
// endpoint and both keys are server-only (BROWSER_FIELDS). Unique (organization, user,
// endpoint). All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const collection = new Collection({
      type: "base",
      name: "push_subscriptions",
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
        { type: "text", name: "endpoint", required: true, max: 1024 },
        { type: "text", name: "p256dh", required: true, max: 256 },
        { type: "text", name: "auth", required: true, max: 128 },
        { type: "text", name: "ua_family", max: 40 },
        { type: "date", name: "last_ok_at" },
        { type: "number", name: "fail_count", onlyInt: true, min: 0 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_push_subscriptions_org_user_endpoint ON push_subscriptions (organization, user, endpoint)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("push_subscriptions"));
  },
);
