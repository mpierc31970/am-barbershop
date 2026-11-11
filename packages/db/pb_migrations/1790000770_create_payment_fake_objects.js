/// <reference path="../pb_data/types.d.ts" />
// PAY-01, BILL-03 (stand-in): state for the fake payment adapter (customers, sessions,
// subscriptions, invoices, accounts, prices, refunds, portal links). A platform collection
// (no org relation; `org_ref` is plain text). Only the fake adapter reads or writes it, and
// that adapter refuses to run in production. All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "payment_fake_objects",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "object_id", required: true, max: 64 },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: [
            "customer",
            "session",
            "subscription",
            "invoice",
            "account",
            "price",
            "refund",
            "portal",
          ],
        },
        { type: "text", name: "org_ref", max: 32 },
        { type: "json", name: "data", maxSize: 200000 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_payment_fake_objects_object ON payment_fake_objects (object_id)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("payment_fake_objects"));
  },
);
