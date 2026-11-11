/// <reference path="../pb_data/types.d.ts" />
// CUSTOM-01, COMM-12 (P12): a person's edit held while their content is locked by a service
// window (D102). Personal rows: user is required and cascades on user delete, so a leftover
// draft never blocks the retention job's orphan-user delete (Review 11 CR-A01).
// discarded_at is a soft discard with a 30 s undo (P12-P9). payload is the person's own text.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const collection = new Collection({
      type: "base",
      name: "held_drafts",
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
          cascadeDelete: true,
        },
        {
          type: "select",
          name: "kind",
          maxSelect: 1,
          values: ["section", "page", "site_part", "addon_record"],
        },
        { type: "json", name: "target" },
        { type: "text", name: "ref", max: 40 },
        { type: "json", name: "payload" },
        { type: "date", name: "discarded_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_held_drafts_org_user ON held_drafts (organization, user, created)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("held_drafts"));
  },
);
