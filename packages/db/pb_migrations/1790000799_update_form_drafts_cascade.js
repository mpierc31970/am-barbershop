/// <reference path="../pb_data/types.d.ts" />
// BILL-14, D233 (review CR-A01): `form_drafts.form` is a required relation. PocketBase
// refuses to delete a record a required relation still points at, so with no cascade a
// hard form delete (D275) and a tenant restore that removes a form (TEN-12, forms are
// "replace", drafts "skip") both failed while any visitor draft existed. Drafts are
// disposable (30-day TTL, nothing worth keeping), so they go with their form.
// All API rules stay null.
function setCascade(app, on) {
  const col = app.findCollectionByNameOrId("form_drafts");
  col.fields.getByName("form").cascadeDelete = on;
  app.save(col);
}

migrate(
  (app) => setCascade(app, true),
  (app) => setCascade(app, false),
);
