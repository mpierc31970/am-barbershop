/// <reference path="../pb_data/types.d.ts" />
// LIFE-02, D283, CONTEXT A4-Q2: closure fields set only by markOrgClosed; a lapse is never
// a closed reason (invariant 9: a billing lapse disables, it never closes or deletes).
// The retention job selects on closed_at. Nothing here is secret. All API rules null.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.add(
      new SelectField({
        name: "closed_reason",
        maxSelect: 1,
        values: ["cancelled", "declined", "taken_down"],
      }),
    );
    col.fields.add(new DateField({ name: "closed_at" }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.removeByName("closed_reason");
    col.fields.removeByName("closed_at");
    app.save(col);
  },
);
