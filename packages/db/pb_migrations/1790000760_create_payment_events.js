/// <reference path="../pb_data/types.d.ts" />
// BILL-08, PAY-01, CONTEXT A1: the webhook idempotency ledger. A platform collection (no
// org relation; `org_ref` is plain text for staff search): unique (provider, event_id) means
// a replayed webhook is recorded once and applied once (T-10-04-04). `processed_at` empty =
// not yet applied (the retry sweep selects on it). All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "payment_events",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "select",
          name: "provider",
          required: true,
          maxSelect: 1,
          values: ["stripe", "fake"],
        },
        { type: "text", name: "event_id", required: true, max: 255 },
        { type: "text", name: "type", required: true, max: 100 },
        { type: "text", name: "account", max: 255 },
        { type: "text", name: "org_ref", max: 32 },
        { type: "date", name: "received_at", required: true },
        { type: "date", name: "processed_at" },
        {
          type: "select",
          name: "outcome",
          maxSelect: 1,
          values: ["applied", "ignored", "failed"],
        },
        { type: "number", name: "attempts", onlyInt: true, min: 0 },
        { type: "text", name: "error", max: 300 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_payment_events_provider_event ON payment_events (provider, event_id)",
        "CREATE INDEX idx_payment_events_processed ON payment_events (processed_at)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("payment_events"));
  },
);
