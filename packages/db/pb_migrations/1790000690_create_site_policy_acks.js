/// <reference path="../pb_data/types.d.ts" />
// AGR-08, D217, CONTEXT A5-Q3: append-only acknowledgements; kept 7 years.
// kind `ack` = publishing acknowledgement of the site privacy/terms template; `review` =
// owner opened Preview after an add-on change (RESEARCH Open Question 3). Plain-text ids
// (RESEARCH Pitfall 5); pb_hooks/legal_append_only.pb.js refuses every update and any
// delete before `retain_until`. No `updated` field. All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "site_policy_acks",
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
          name: "user",
          required: true,
          pattern: "^[a-z0-9]{15}$",
        },
        { type: "text", name: "user_name", max: 120 },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["ack", "review"],
        },
        {
          type: "number",
          name: "template_version",
          required: true,
          onlyInt: true,
          min: 1,
        },
        {
          type: "text",
          name: "privacy_sha256",
          required: true,
          pattern: "^[a-f0-9]{64}$",
        },
        {
          type: "text",
          name: "terms_sha256",
          required: true,
          pattern: "^[a-f0-9]{64}$",
        },
        { type: "json", name: "clause_ids", required: true, maxSize: 4000 },
        { type: "text", name: "ip", max: 64 },
        { type: "date", name: "acked_at", required: true },
        { type: "date", name: "retain_until", required: true },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE INDEX idx_site_policy_acks_org ON site_policy_acks (organization, acked_at)",
        "CREATE INDEX idx_site_policy_acks_retain ON site_policy_acks (retain_until)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    // Dropping a table skips the record delete hooks, so a down migration must never
    // destroy evidence: it refuses while any row exists (review IN-A05).
    const col = app.findCollectionByNameOrId("site_policy_acks");
    if (app.countRecords(col) > 0) {
      throw new Error(
        "site_policy_acks holds 7-year acknowledgement evidence; refusing to drop it (empty it through the retention job first)",
      );
    }
    app.delete(col);
  },
);
