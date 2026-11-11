/// <reference path="../pb_data/types.d.ts" />
// ONB-06, ONB-12 / CONTEXT A1-Q2: a saved `/start` quote. A platform collection: it has NO
// field named organization (RESEARCH Pitfall 2), so it never enters the tenant registry;
// the org it became is recorded in `merged_org` at Submit (06-08).
// The link token is stored only as its sha256 (`token_hash`, unique). All API rules null
// (superuser only, invariant 1); reads and writes go through the @cds/db chokepoint.
// business_name, description (Submit step A) and fit_category (set when blocked) let step B
// and staff read them (planner decision; RESEARCH Open Q1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "quotes",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "token_hash", required: true, max: 64 },
        { type: "email", name: "email" },
        {
          type: "select",
          name: "path",
          maxSelect: 1,
          values: ["standard", "studio", "shop"],
        },
        { type: "text", name: "business_type", max: 40 },
        { type: "text", name: "business_type_other", max: 80 },
        { type: "text", name: "business_name", max: 120 },
        { type: "text", name: "description", max: 200 },
        { type: "json", name: "selections", maxSize: 20000 },
        { type: "json", name: "totals", maxSize: 20000 },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["draft", "saved", "submitted", "expired", "blocked"],
        },
        { type: "text", name: "fit_category", max: 80 },
        {
          type: "number",
          name: "reminders_sent",
          onlyInt: true,
          min: 0,
          max: 2,
        },
        { type: "date", name: "last_reminder_at" },
        { type: "date", name: "saved_at" },
        { type: "date", name: "expires_at" },
        {
          type: "relation",
          name: "merged_org",
          collectionId: orgs.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_quotes_token_hash ON quotes (token_hash)",
        "CREATE INDEX idx_quotes_status_saved ON quotes (status, saved_at)",
        "CREATE INDEX idx_quotes_email ON quotes (email)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("quotes"));
  },
);
