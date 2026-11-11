/// <reference path="../pb_data/types.d.ts" />
// EMAIL-01 / D267, D138: addresses that must not be emailed (unsubscribe, bounce, complaint,
// staff). Empty organization = CDS itself as the sender (D138); those rows are unreachable
// from an OrgContext, as with audit_log. Append-only: created, no updated.
// One row per (organization, email, scope). All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "email_suppressions",
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
        { type: "email", name: "email", required: true },
        {
          type: "select",
          name: "reason",
          required: true,
          maxSelect: 1,
          values: ["unsubscribe", "bounce", "complaint", "staff"],
        },
        {
          type: "select",
          name: "scope",
          required: true,
          maxSelect: 1,
          values: ["marketing", "all"],
        },
        { type: "text", name: "source_type", max: 40 },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_email_suppressions_org_email_scope ON email_suppressions (organization, email, scope)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("email_suppressions"));
  },
);
