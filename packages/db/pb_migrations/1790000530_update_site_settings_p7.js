/// <reference path="../pb_data/types.d.ts" />
// CONT-29 / CONT-36, D198, D249: site_settings grows from the banner into the whole site
// chrome: `nav` and `footer` (07-25), `seo` (07-26/07-30; holds allow_ai_crawlers), general
// `settings` and the site `language` (BCP 47, max 35, validated by 07-26). Nothing here is
// secret; all of it is visitor chrome. All API rules null (invariant 1).
const ADDED = ["nav", "footer", "seo", "settings", "language"];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("site_settings");
    col.fields.add(new JSONField({ name: "nav" }));
    col.fields.add(new JSONField({ name: "footer" }));
    col.fields.add(new JSONField({ name: "seo" }));
    col.fields.add(new JSONField({ name: "settings" }));
    col.fields.add(new TextField({ name: "language", max: 35 }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("site_settings");
    for (const name of ADDED) col.fields.removeByName(name);
    app.save(col);
  },
);
