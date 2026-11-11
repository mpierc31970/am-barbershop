/// <reference path="../pb_data/types.d.ts" />
// LIFE-02, D283, CONTEXT A4-Q2 (review WR-A02): the status an org had before
// markOrgClosed set it to disabled, so reopenOrg restores it instead of forcing
// "active" (a held site would otherwise go live without fit review). Set only by
// markOrgClosed, cleared by reopenOrg. Nothing here is secret. All API rules null.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.add(
      new SelectField({
        name: "closed_prev_status",
        maxSelect: 1,
        values: ["active", "held", "disabled"],
      }),
    );
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.removeByName("closed_prev_status");
    app.save(col);
  },
);
