/// <reference path="../pb_data/types.d.ts" />
// BILL-03, BILL-06, BILL-19, CONTEXT A2: one billing record per org (unique). Mirrors the
// provider's customer + subscription; written only by the chokepoint's billing writers.
// Card display is brand + last4 + expiry ("Visa ending 4242"); no other card data is stored
// anywhere (T-10-04-05). Provider ids never leave the server (export list, D187).
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "billing_accounts",
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
          required: true,
          maxSelect: 1,
          values: ["stripe", "fake"],
        },
        { type: "text", name: "customer_id", max: 255 },
        { type: "text", name: "subscription_id", max: 255 },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["none", "active", "past_due", "lapsed", "canceled"],
        },
        {
          type: "select",
          name: "cadence",
          maxSelect: 1,
          values: ["monthly", "yearly"],
        },
        {
          type: "select",
          name: "build_plan",
          maxSelect: 1,
          values: ["full", "installments"],
        },
        { type: "number", name: "installments_paid", onlyInt: true, min: 0 },
        { type: "date", name: "paid_at" },
        { type: "bool", name: "care_plan" },
        { type: "number", name: "media_5gb_qty", onlyInt: true, min: 0 },
        { type: "number", name: "media_25gb_qty", onlyInt: true, min: 0 },
        { type: "date", name: "current_period_end" },
        { type: "date", name: "lapsed_at" },
        { type: "date", name: "price_locked_until" },
        { type: "text", name: "checkout_session_id", max: 255 },
        { type: "json", name: "checkout_draft", maxSize: 20000 },
        { type: "number", name: "amount_due_cents", onlyInt: true, min: 0 },
        { type: "text", name: "card_brand", max: 32 },
        { type: "text", name: "card_last4", max: 4 },
        { type: "text", name: "card_exp", max: 7 },
        { type: "date", name: "declined_at" },
        { type: "date", name: "restored_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_billing_accounts_org ON billing_accounts (organization)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("billing_accounts"));
  },
);
