/// <reference path="../pb_data/types.d.ts" />
// CONT-36, D275: pop-ups can be soft-deleted while a page version still references them
// (07-28). Outside the outline's 510-610 range on purpose: no other P7 plan owns a
// migration. Nothing here is secret. All API rules null (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("popups");
    col.fields.add(new DateField({ name: "deleted_at" }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("popups");
    col.fields.removeByName("deleted_at");
    app.save(col);
  },
);
