/// <reference path="../pb_data/types.d.ts" />
// AGR-03..05, D81, D283, CONTEXT A2-Q2: append-only signing evidence; plain-text ids so
// deleting a user/org never updates a row (RESEARCH Pitfall 5); kept 7 years
// (`retain_until`; pb_hooks/legal_append_only.pb.js refuses every update and any delete
// before it). Integrity fields are named *_sha256 (Pitfall 7). No `updated` field.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "agreement_signatures",
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
          type: "text",
          name: "signer",
          required: true,
          pattern: "^[a-z0-9]{15}$",
        },
        { type: "email", name: "signer_email", required: true },
        { type: "text", name: "signer_name", required: true, min: 2, max: 120 },
        { type: "text", name: "org_name", max: 200 },
        { type: "json", name: "policies", required: true },
        { type: "json", name: "consent", required: true },
        { type: "text", name: "ip", max: 64 },
        { type: "text", name: "user_agent", max: 512 },
        {
          type: "select",
          name: "auth_method",
          required: true,
          maxSelect: 1,
          values: ["otp", "password", "unknown"],
        },
        { type: "date", name: "signed_at", required: true },
        { type: "json", name: "order_snapshot", maxSize: 20000 },
        { type: "text", name: "document_key", required: true },
        {
          type: "text",
          name: "document_sha256",
          required: true,
          pattern: "^[a-f0-9]{64}$",
        },
        {
          type: "text",
          name: "evidence_sha256",
          required: true,
          pattern: "^[a-f0-9]{64}$",
        },
        { type: "date", name: "retain_until", required: true },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["signup", "reaccept"],
        },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE INDEX idx_agreement_signatures_org ON agreement_signatures (organization, signed_at)",
        "CREATE INDEX idx_agreement_signatures_retain ON agreement_signatures (retain_until)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    // Dropping a table skips the record delete hooks, so a down migration must never
    // destroy evidence: it refuses while any row exists (review IN-A05).
    const col = app.findCollectionByNameOrId("agreement_signatures");
    if (app.countRecords(col) > 0) {
      throw new Error(
        "agreement_signatures holds 7-year signature evidence; refusing to drop it (empty it through the retention job first)",
      );
    }
    app.delete(col);
  },
);
