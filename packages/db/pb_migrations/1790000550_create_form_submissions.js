/// <reference path="../pb_data/types.d.ts" />
// CONT-25, D231: one row per message a visitor sends through a form (owners call it a
// "message"; the Inbox lists them, 07-19). `form` is optional with no cascade: a hard-deleted
// form unlinks and never blocks, and `form_name` keeps the label. `page` is where it was
// sent ("On Home"). `data` is keyed by field id; `labels` snapshots the labels. The
// `contact` relation is added by 1790000560 (contacts does not exist yet). Never public.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const forms = app.findCollectionByNameOrId("forms");
    const pages = app.findCollectionByNameOrId("pages");
    const collection = new Collection({
      type: "base",
      name: "form_submissions",
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
          required: false,
          collectionId: forms.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "text", name: "form_name", max: 80 },
        {
          type: "relation",
          name: "page",
          required: false,
          collectionId: pages.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "json", name: "data" },
        { type: "json", name: "labels" },
        { type: "bool", name: "spam" },
        { type: "date", name: "read_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_form_submissions_org_form_created ON form_submissions (organization, form, created)",
        "CREATE INDEX idx_form_submissions_org_spam_read ON form_submissions (organization, spam, read_at)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("form_submissions"));
  },
);
