/// <reference path="../pb_data/types.d.ts" />
// 07-12 (CONT-14 media library UI needs): media_assets gains the uploaded file `name` (text,
// max 200) for the library tile, drawer title, delete dialog, describe list and search. It is
// in the registry `export` list only and never public: file names can leak personal info.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("media_assets");
    col.fields.add(new TextField({ name: "name", max: 200 }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("media_assets");
    col.fields.removeByName("name");
    app.save(col);
  },
);
