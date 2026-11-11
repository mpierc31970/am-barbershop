/// <reference path="../pb_data/types.d.ts" />
// COMM-01, COMM-02, COMM-04 (P12): one row per message in a support thread. visibility
// "internal" rows are CDS staff notes the tenant never sees (tenant reads filter
// visibility = 'public' in the query, never in UI code). event is a system line
// {kind, from?, to?}; attachments is a summary [{id, name, size, mime, scan}] of the
// support_files rows. author_staff and visibility are serverOnly in BROWSER_FIELDS.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const threads = app.findCollectionByNameOrId("support_threads");
    const collection = new Collection({
      type: "base",
      name: "support_messages",
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
          required: true,
          collectionId: threads.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "select",
          name: "author_kind",
          maxSelect: 1,
          values: ["member", "staff", "system"],
        },
        {
          type: "relation",
          name: "author_user",
          required: false,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "text", name: "author_staff", max: 40 },
        { type: "text", name: "author_name", max: 60 },
        { type: "text", name: "body", max: 5000 },
        {
          type: "select",
          name: "visibility",
          required: true,
          maxSelect: 1,
          values: ["public", "internal"],
        },
        { type: "json", name: "event" },
        { type: "json", name: "attachments" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_support_messages_org_thread ON support_messages (organization, thread, created)",
        "CREATE INDEX idx_support_messages_thread_vis ON support_messages (thread, visibility, created)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("support_messages"));
  },
);
