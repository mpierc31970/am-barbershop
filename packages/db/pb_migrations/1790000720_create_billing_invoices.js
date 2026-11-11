/// <reference path="../pb_data/types.d.ts" />
// BILL-09, BILL-20, CONTEXT A4, D214: the invoice mirror (no card data). Payment records
// outlive the org: `organization` is plain text (the P9 legal-evidence pattern, RESEARCH
// P9 Pitfall 5), so deleting the org row never touches these rows; the retention job stamps
// `retain_until` when the org is deleted (10-28). Every chokepoint read still filters
// `organization = {:org}`. Provider ids and hosted URLs never leave the server (D187).
// `work_order` is added by 1790000740 once work_orders exists.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "billing_invoices",
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
          name: "provider",
          maxSelect: 1,
          values: ["stripe", "fake"],
        },
        { type: "text", name: "provider_invoice_id", required: true, max: 255 },
        { type: "text", name: "number", max: 64 },
        { type: "date", name: "issued_at", required: true },
        { type: "text", name: "description", max: 500 },
        {
          type: "select",
          name: "kind",
          maxSelect: 1,
          values: ["checkout", "renewal", "change", "one_off", "work_order"],
        },
        { type: "number", name: "amount_cents", onlyInt: true },
        { type: "number", name: "tax_cents", onlyInt: true, min: 0 },
        { type: "number", name: "refunded_cents", onlyInt: true, min: 0 },
        {
          type: "select",
          name: "status",
          maxSelect: 1,
          values: [
            "draft",
            "open",
            "paid",
            "uncollectible",
            "void",
            "refunded",
          ],
        },
        { type: "bool", name: "has_installment" },
        { type: "url", name: "hosted_url" },
        { type: "url", name: "pdf_url" },
        { type: "date", name: "retain_until" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_billing_invoices_org_provider_id ON billing_invoices (organization, provider_invoice_id)",
        "CREATE INDEX idx_billing_invoices_org_issued ON billing_invoices (organization, issued_at)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("billing_invoices"));
  },
);
