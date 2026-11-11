/// <reference path="../pb_data/types.d.ts" />
// CONT-25 / CONT-36, D231, D271, D275: tenant forms (the form builder, 07-15). `fields` and
// `after_submit` are json; `notify_route` picks the org email route purpose (the writer
// defaults it to `inquiries`). `deleted_at` soft-deletes a referenced form. Never public:
// notify_route (reveals the routing setup) and deleted_at. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "forms",
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
        { type: "text", name: "name", required: true, max: 80 },
        {
          type: "select",
          name: "template",
          maxSelect: 1,
          values: [
            "blank",
            "contact",
            "quote-request",
            "client-intake",
            "feedback",
            "job-application",
          ],
        },
        { type: "select", name: "layout", maxSelect: 1, values: ["1", "2"] },
        { type: "json", name: "fields" },
        { type: "json", name: "after_submit" },
        {
          type: "select",
          name: "notify_route",
          maxSelect: 1,
          values: ["default", "inquiries", "newsletter", "billing", "account"],
        },
        { type: "bool", name: "newsletter_checkbox" },
        { type: "text", name: "newsletter_wording", max: 500 },
        { type: "date", name: "deleted_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_forms_org ON forms (organization)"],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("forms"));
  },
);
