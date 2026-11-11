/// <reference path="../pb_data/types.d.ts" />
// TEN-08 / D10 / invariant 10: audit_log is append-only (created only, no updated).
// organization null = platform-wide entry; actor null = system job; impersonator set when
// CDS staff act inside a tenant. All API rules null (superuser only).
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "audit_log",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "relation",
          name: "organization",
          required: false,
          collectionId: orgs.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "relation",
          name: "actor",
          required: false,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "relation",
          name: "impersonator",
          required: false,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "text", name: "action", required: true },
        { type: "text", name: "target_collection" },
        { type: "text", name: "target_id" },
        { type: "text", name: "ip" },
        { type: "json", name: "meta" },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE INDEX idx_audit_log_org_created ON audit_log (organization, created)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("audit_log"));
  },
);
