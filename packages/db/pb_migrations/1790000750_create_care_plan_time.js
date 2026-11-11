/// <reference path="../pb_data/types.d.ts" />
// BILL-20, CONTEXT A4: Care Plan time log. Append-only (no `updated`); staff log minutes
// against an org, the hub shows the month's total. Nothing here is secret.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "care_plan_time",
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
          type: "number",
          name: "minutes",
          required: true,
          onlyInt: true,
          min: 1,
          max: 600,
        },
        { type: "text", name: "note", required: true, max: 500 },
        { type: "text", name: "ticket_ref", max: 64 },
        { type: "text", name: "staff", required: true, max: 255 },
        { type: "date", name: "logged_at", required: true },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE INDEX idx_care_plan_time_org_logged ON care_plan_time (organization, logged_at)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("care_plan_time"));
  },
);
