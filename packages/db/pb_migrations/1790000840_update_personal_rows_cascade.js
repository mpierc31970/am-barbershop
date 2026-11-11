/// <reference path="../pb_data/types.d.ts" />
// Review 11 CR-A01: the P11 per-person rows hold a required `user` relation with no
// cascade. PocketBase refuses to delete a record a required relation still points at, so
// a leftover `member_prefs`, `alerts` or `push_subscriptions` row (from a site the person
// was removed from) blocked the retention job's orphan-user delete, and the account was
// then left behind for good. Those rows are the person's own and worthless without them,
// so they go with the user. `data_exports.requested_by` becomes optional instead: the job
// row is kept (it belongs to the org) and only the link to the deleted person is dropped.
// Published migrations are immutable, hence this new one. All API rules stay null.
const CASCADE = [
  ["member_prefs", "user"],
  ["alerts", "user"],
  ["push_subscriptions", "user"],
];

function apply(app, on) {
  for (const [name, field] of CASCADE) {
    const col = app.findCollectionByNameOrId(name);
    col.fields.getByName(field).cascadeDelete = on;
    app.save(col);
  }
  const exports = app.findCollectionByNameOrId("data_exports");
  exports.fields.getByName("requested_by").required = !on;
  app.save(exports);
}

migrate(
  (app) => apply(app, true),
  (app) => {
    // A row whose requester was deleted cannot be required again; drop it first.
    app
      .db()
      .newQuery(
        "DELETE FROM data_exports WHERE requested_by = '' OR requested_by IS NULL",
      )
      .execute();
    apply(app, false);
  },
);
