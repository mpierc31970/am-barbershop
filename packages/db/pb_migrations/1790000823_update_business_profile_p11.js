/// <reference path="../pb_data/types.d.ts" />
// P11 (11-03): business_profile gains
//   sensitive_practice  select on|off; empty = automatic by business type (D305: on for
//                       therapy, counseling and health; the owner can change it, DASH-37)
//   grow_checklist      json string[] of ticked Grow tip ids, per org (DASH-14)
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("business_profile");
    col.fields.add(
      new SelectField({
        name: "sensitive_practice",
        maxSelect: 1,
        values: ["on", "off"],
      }),
    );
    col.fields.add(new JSONField({ name: "grow_checklist", maxSize: 4000 }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("business_profile");
    col.fields.removeByName("sensitive_practice");
    col.fields.removeByName("grow_checklist");
    app.save(col);
  },
);
