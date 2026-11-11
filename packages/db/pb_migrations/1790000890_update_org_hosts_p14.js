/// <reference path="../pb_data/types.d.ts" />
// DOM-02, DOM-06, D13 (14-08, P14-P2, P14-P4, P14-P5): org_hosts gains the `redirect` kind (an
// old custom host that now 301s to the primary), `verified_at` (set when delegation is
// verified; the edge only serves verified custom hosts) and `redirect_to` (the target host of
// a redirect row). Data fix: every existing `custom` row is already live, so it gets
// verified_at = updated and keeps serving. Down deletes redirect rows first, then restores the
// two-value kind list and removes both fields. All API rules stay null (invariant 1).
const P2_KINDS = ["preview", "custom"];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("org_hosts");
    col.fields.getByName("kind").values = P2_KINDS.concat(["redirect"]);
    col.fields.add(new DateField({ name: "verified_at" }));
    col.fields.add(new TextField({ name: "redirect_to", max: 253 }));
    app.save(col);

    for (const rec of app.findRecordsByFilter(
      "org_hosts",
      "kind = 'custom' && verified_at = ''",
      "",
      0,
      0,
    )) {
      rec.set("verified_at", rec.getString("updated"));
      app.save(rec);
    }
  },
  (app) => {
    for (const rec of app.findRecordsByFilter(
      "org_hosts",
      "kind = 'redirect'",
      "",
      0,
      0,
    )) {
      app.delete(rec);
    }
    const col = app.findCollectionByNameOrId("org_hosts");
    col.fields.removeByName("verified_at");
    col.fields.removeByName("redirect_to");
    col.fields.getByName("kind").values = P2_KINDS;
    app.save(col);
  },
);
