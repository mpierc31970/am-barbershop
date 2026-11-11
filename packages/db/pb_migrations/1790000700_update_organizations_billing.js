/// <reference path="../pb_data/types.d.ts" />
// BILL-06, BILL-08, CONTEXT A3, A4: the org's billing state, mirrored from billing_accounts
// by the webhook applier so resolution and the hub read it without a join. `launched_at`
// starts the 30-day "Polish" window (A4); `build_started_at` marks when the build fee was
// paid. A lapse never closes or deletes (invariant 9). Nothing here is secret.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.add(
      new SelectField({
        name: "billing_status",
        maxSelect: 1,
        values: ["none", "active", "past_due", "lapsed"],
      }),
    );
    col.fields.add(new DateField({ name: "launched_at" }));
    col.fields.add(new DateField({ name: "build_started_at" }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.removeByName("billing_status");
    col.fields.removeByName("launched_at");
    col.fields.removeByName("build_started_at");
    app.save(col);
  },
);
