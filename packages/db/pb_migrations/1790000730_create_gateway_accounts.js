/// <reference path="../pb_data/types.d.ts" />
// PAY-01, D296, CONTEXT A1: the tenant's own payment gateway (Stripe Connect) for their
// customers' payments. CDS is never the processor. One row per org per provider. `status`
// is derived from the provider's account (connected / restricted / disconnected);
// `alerted_status` stops a repeat alert for the same state. `account_id` never leaves the
// server (D187). All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "gateway_accounts",
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
          name: "provider",
          maxSelect: 1,
          values: ["stripe", "fake"],
        },
        { type: "text", name: "account_id", required: true, max: 255 },
        { type: "bool", name: "charges_enabled" },
        { type: "bool", name: "details_submitted" },
        { type: "text", name: "display_name", max: 200 },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["connected", "restricted", "disconnected"],
        },
        { type: "date", name: "checked_at" },
        { type: "text", name: "alerted_status", max: 32 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_gateway_accounts_org_provider ON gateway_accounts (organization, provider)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("gateway_accounts"));
  },
);
