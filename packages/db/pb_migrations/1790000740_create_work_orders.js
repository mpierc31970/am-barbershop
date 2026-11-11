/// <reference path="../pb_data/types.d.ts" />
// BILL-19, BILL-09, CONTEXT A4, D214: quoted extra work (polish, custom block, private or
// premium add-on), deposit + balance invoices. Payment records outlive the org: plain-text
// `organization` (P9 legal-evidence pattern) and a `retain_until` the retention job stamps
// on org deletion (10-28). Invoice ids and the staff author never leave the server (D187).
// Also adds billing_invoices.work_order now that this collection exists.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "work_orders",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "text",
          name: "organization",
          required: true,
          pattern: "^[a-z0-9]{15}$",
        },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["polish", "custom_block", "private_addon", "premium_addon"],
        },
        { type: "text", name: "title", required: true, max: 120 },
        { type: "text", name: "scope", max: 8000 },
        { type: "number", name: "blocks", onlyInt: true, min: 0 },
        { type: "number", name: "rate_cents", onlyInt: true, min: 0 },
        {
          type: "number",
          name: "total_cents",
          required: true,
          onlyInt: true,
          min: 0,
        },
        { type: "number", name: "deposit_cents", onlyInt: true, min: 0 },
        { type: "number", name: "balance_cents", onlyInt: true, min: 0 },
        { type: "number", name: "maintenance_cents", onlyInt: true, min: 0 },
        { type: "text", name: "addon_slug", max: 64 },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: [
            "draft",
            "sent",
            "accepted",
            "deposit_paid",
            "delivered",
            "paid",
            "declined",
            "expired",
          ],
        },
        { type: "date", name: "sent_at" },
        { type: "date", name: "valid_until" },
        { type: "date", name: "accepted_at" },
        { type: "date", name: "delivered_at" },
        { type: "date", name: "paid_at" },
        { type: "date", name: "declined_at" },
        { type: "text", name: "accepted_by", max: 64 },
        { type: "text", name: "deposit_invoice_id", max: 255 },
        { type: "text", name: "balance_invoice_id", max: 255 },
        { type: "text", name: "created_by", max: 255 },
        { type: "date", name: "retain_until" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_work_orders_org_status ON work_orders (organization, status)",
      ],
    });
    app.save(collection);

    const invoices = app.findCollectionByNameOrId("billing_invoices");
    invoices.fields.add(
      new RelationField({
        name: "work_order",
        collectionId: collection.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    );
    app.save(invoices);
  },
  (app) => {
    const invoices = app.findCollectionByNameOrId("billing_invoices");
    invoices.fields.removeByName("work_order");
    app.save(invoices);
    app.delete(app.findCollectionByNameOrId("work_orders"));
  },
);
