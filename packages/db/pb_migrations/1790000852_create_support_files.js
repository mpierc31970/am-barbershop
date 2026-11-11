/// <reference path="../pb_data/types.d.ts" />
// COMM-04, COMM-06 (P12, P12-P1): one row per support attachment, for indexed id lookup
// behind signed links and one sorted Documents list. scan: tenant files stay "pending" until
// a scan passes; staff-authored files are "staff" (P12-P3). The storage key is named
// object_key (never "key", RESEARCH Pitfall 7) and is serverOnly in BROWSER_FIELDS.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const threads = app.findCollectionByNameOrId("support_threads");
    const messages = app.findCollectionByNameOrId("support_messages");
    const collection = new Collection({
      type: "base",
      name: "support_files",
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
          name: "thread",
          required: false,
          collectionId: threads.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "relation",
          name: "message",
          required: false,
          collectionId: messages.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "text", name: "name", max: 200 },
        { type: "number", name: "size", onlyInt: true, min: 0 },
        { type: "text", name: "mime", max: 100 },
        { type: "text", name: "ext", max: 8 },
        {
          type: "select",
          name: "scan",
          maxSelect: 1,
          values: ["clean", "pending", "staff"],
        },
        {
          type: "select",
          name: "author_kind",
          maxSelect: 1,
          values: ["member", "staff"],
        },
        { type: "text", name: "object_key", max: 400 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_support_files_org_created ON support_files (organization, created)",
        "CREATE INDEX idx_support_files_message ON support_files (message)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("support_files"));
  },
);
