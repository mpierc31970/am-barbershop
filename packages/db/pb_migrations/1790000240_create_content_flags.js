/// <reference path="../pb_data/types.d.ts" />
// D248 / CONTEXT A5: content_flags records a screening verdict on tenant content. target_id
// is TEXT, not a relation (it points into any collection, like audit_log). verdict unsure /
// held / error; status open until staff resolve it. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "content_flags",
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
        { type: "text", name: "target_collection" },
        { type: "text", name: "target_id" },
        {
          type: "select",
          name: "verdict",
          maxSelect: 1,
          values: ["unsure", "held", "error"],
        },
        { type: "json", name: "reasons" },
        {
          type: "select",
          name: "status",
          maxSelect: 1,
          values: ["open", "resolved"],
        },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_content_flags_org_status ON content_flags (organization, status)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("content_flags"));
  },
);
