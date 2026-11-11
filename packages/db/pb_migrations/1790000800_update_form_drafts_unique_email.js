/// <reference path="../pb_data/types.d.ts" />
// BILL-14, D233 (review WR-A05): "one draft per (form, email); saving again replaces it and
// kills the old link". The (form, email) index was not unique and the writer reads then
// writes, so two concurrent saves left two live drafts and two valid resume links. The
// index becomes unique; the writer serialises per (form, email) and retries once on a
// refusal. Applying this fails if duplicates already exist: delete the older of each pair
// first (HUMAN-CHECKS). All API rules stay null.
const OLD = "idx_form_drafts_form_email";
const PLAIN = `CREATE INDEX ${OLD} ON form_drafts (form, email)`;
const UNIQUE = `CREATE UNIQUE INDEX ${OLD} ON form_drafts (form, email)`;

/** Matched by index name: PocketBase may store the SQL normalised. */
function replaceIndex(app, sql) {
  const col = app.findCollectionByNameOrId("form_drafts");
  col.indexes = [
    ...col.indexes.filter(
      (i) => !i.includes(` ${OLD} `) && !i.includes("`" + OLD + "`"),
    ),
    sql,
  ];
  app.save(col);
}

migrate(
  (app) => replaceIndex(app, UNIQUE),
  (app) => replaceIndex(app, PLAIN),
);
