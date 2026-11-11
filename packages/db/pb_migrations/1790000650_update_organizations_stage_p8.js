/// <reference path="../pb_data/types.d.ts" />
// P8 (08-02): organizations.stage gains being_built (D312 first stage; TMPL-04, CONTEXT A2-Q5).
// Set when automated assembly hands the site to the owner. Invariant 1: access only via @cds/db.
// Down restores the exact P6 list (1790000400) after moving any being_built org back to
// ready_for_build, so the down never strands a row on a value the select no longer has.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.getByName("stage").values = [
      "intake",
      "fit_review",
      "ready_for_build",
      "being_built",
    ];
    app.save(col);
  },
  (app) => {
    app
      .db()
      .newQuery(
        "UPDATE organizations SET stage = 'ready_for_build' WHERE stage = 'being_built'",
      )
      .execute();
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.getByName("stage").values = [
      "intake",
      "fit_review",
      "ready_for_build",
    ];
    app.save(col);
  },
);
