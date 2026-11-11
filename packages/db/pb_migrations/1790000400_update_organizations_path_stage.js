/// <reference path="../pb_data/types.d.ts" />
// ONB-08 / CONTEXT Area 1 "Org lifecycle field": organizations gains the chosen booking
// `path` (D176-D178) and the setup `stage`. Both are optional: existing orgs (demo, demo-b)
// keep empty values, and empty stage means "not in setup" (RESEARCH Pitfall 15).
// PD-4: P6 adds exactly intake / fit_review / ready_for_build. Later phases add their own
// values (no `live` now, RESEARCH Open Q4).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    orgs.fields.add(
      new SelectField({
        name: "path",
        maxSelect: 1,
        required: false,
        values: ["standard", "studio", "shop"],
      }),
    );
    orgs.fields.add(
      new SelectField({
        name: "stage",
        maxSelect: 1,
        required: false,
        values: ["intake", "fit_review", "ready_for_build"],
      }),
    );
    app.save(orgs);
  },
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    orgs.fields.removeByName("path");
    orgs.fields.removeByName("stage");
    app.save(orgs);
  },
);
