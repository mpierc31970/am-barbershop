/// <reference path="../pb_data/types.d.ts" />
// P11 (11-03; D312, DASH-02/30/33): organizations.stage gains ready_for_review (CDS finished
// the build, the owner reviews) and live (final; launched_at set). Also the CDS build note
// shown on Today while the site is being built (build_note <= 280, build_note_at) and the
// org's analytics ids (json {ga4_measurement_id?, ga4_property_id?, gsc_site_url?, owner?}),
// server-only. Down moves ready_for_review / live orgs back to being_built before narrowing,
// so no row is stranded on a value the select no longer has. Invariant 1: @cds/db only.
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.getByName("stage").values = [
      "intake",
      "fit_review",
      "ready_for_build",
      "being_built",
      "ready_for_review",
      "live",
    ];
    col.fields.add(new TextField({ name: "build_note", max: 280 }));
    col.fields.add(new DateField({ name: "build_note_at" }));
    col.fields.add(new JSONField({ name: "analytics", maxSize: 4000 }));
    app.save(col);
  },
  (app) => {
    app
      .db()
      .newQuery(
        "UPDATE organizations SET stage = 'being_built' WHERE stage IN ('ready_for_review', 'live')",
      )
      .execute();
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.removeByName("build_note");
    col.fields.removeByName("build_note_at");
    col.fields.removeByName("analytics");
    col.fields.getByName("stage").values = [
      "intake",
      "fit_review",
      "ready_for_build",
      "being_built",
    ];
    app.save(col);
  },
);
