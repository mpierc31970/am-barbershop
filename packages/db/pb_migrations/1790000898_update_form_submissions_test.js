/// <reference path="../pb_data/types.d.ts" />
// DOM-10, D172 (14-09, P14-P26, P14-P40): form_submissions gains `is_test`. A submission sent
// with a valid review cookie is stored with is_test = true and shows in Inbox with a neutral
// "Test" badge (never hidden).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("form_submissions");
    col.fields.add(new BoolField({ name: "is_test" }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("form_submissions");
    col.fields.removeByName("is_test");
    app.save(col);
  },
);
