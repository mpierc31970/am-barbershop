/// <reference path="../pb_data/types.d.ts" />
// CONT-16 (14-09, P14-P2): org_indexing gains the sitemap-submission outcome (14-26's
// SitemapSubmitter; the stand-in records "logged"). serverOnly like its peers.
const ADDED = ["last_submit_at", "last_submit_result"];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("org_indexing");
    col.fields.add(new DateField({ name: "last_submit_at" }));
    col.fields.add(
      new SelectField({
        name: "last_submit_result",
        maxSelect: 1,
        required: false,
        values: ["logged", "ok", "error", "skipped"],
      }),
    );
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("org_indexing");
    for (const name of ADDED) col.fields.removeByName(name);
    app.save(col);
  },
);
