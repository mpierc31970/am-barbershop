/// <reference path="../pb_data/types.d.ts" />
// BILL-14, D233 (10-37): Forms Pro "save and finish later". One draft per (form, email);
// saving again replaces it. Only the sha256 of the resume token is stored (`token_hash`,
// unique); the raw token lives only in the emailed link. File answers are never saved.
// Drafts expire after 30 days and the daily retention job deletes them. All API rules null
// (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const forms = app.findCollectionByNameOrId("forms");
    const collection = new Collection({
      type: "base",
      name: "form_drafts",
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
          type: "relation",
          name: "form",
          required: true,
          collectionId: forms.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "text", name: "email", required: true, max: 320 },
        { type: "json", name: "data", maxSize: 65536 },
        {
          type: "text",
          name: "token_hash",
          required: true,
          min: 64,
          max: 64,
          hidden: true,
        },
        { type: "date", name: "expires_at", required: true },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_form_drafts_token_hash ON form_drafts (token_hash)",
        "CREATE INDEX idx_form_drafts_org_expires ON form_drafts (organization, expires_at)",
        "CREATE INDEX idx_form_drafts_form_email ON form_drafts (form, email)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("form_drafts"));
  },
);
