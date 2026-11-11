/// <reference path="../pb_data/types.d.ts" />
// ONB-09 / D173: where a tenant's email goes, per purpose (default, inquiries, newsletter,
// billing, account). An address is used only after it is confirmed. confirm_hash is the
// sha256 of the confirm link token; it is NEVER exported, public or filterable (RESEARCH
// Pitfall 12). All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "org_email_routes",
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
          type: "select",
          name: "purpose",
          required: true,
          maxSelect: 1,
          values: ["default", "inquiries", "newsletter", "billing", "account"],
        },
        { type: "email", name: "address", required: true },
        { type: "text", name: "sender_name", max: 120 },
        { type: "date", name: "confirmed_at" },
        { type: "date", name: "bounced_at" },
        { type: "text", name: "confirm_hash", max: 64 },
        { type: "date", name: "confirm_expires" },
        { type: "date", name: "last_confirm_sent_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_org_email_routes_org_purpose ON org_email_routes (organization, purpose)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("org_email_routes"));
  },
);
