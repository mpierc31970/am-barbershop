/// <reference path="../pb_data/types.d.ts" />
// ONB-10 (14-09, P14-P20): business_profile gains own-domain sending state. `sending_domain`
// and `sending_status` are written only by the system (job step `sending`, P14-P19) and are
// serverOnly in BROWSER_FIELDS; the owner sets only `sending_local_part` (the part before @).
const ADDED = ["sending_domain", "sending_local_part", "sending_status"];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("business_profile");
    col.fields.add(new TextField({ name: "sending_domain", max: 253 }));
    col.fields.add(new TextField({ name: "sending_local_part", max: 64 }));
    col.fields.add(
      new SelectField({
        name: "sending_status",
        maxSelect: 1,
        required: false,
        values: ["none", "pending", "verified", "failed"],
      }),
    );
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("business_profile");
    for (const name of ADDED) col.fields.removeByName(name);
    app.save(col);
  },
);
