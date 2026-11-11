/// <reference path="../pb_data/types.d.ts" />
// STAFF-23, STAFF-25 (13-11, P13-P6 spare 879): media_assets `status` gains `held`. An image
// the moderator holds on upload is kept (the owner's file is never lost) but is not usable:
// every resolver, promote and public read gates on status `ready`. A content_flags row
// (source `image`) puts it in the review queue. Down maps held rows to `failed` first, then
// restores the P7 values. All API rules stay null (invariant 1).
const P7_STATUS = ["uploading", "processing", "ready", "failed"];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("media_assets");
    col.fields.getByName("status").values = P7_STATUS.concat(["held"]);
    app.save(col);
  },
  (app) => {
    for (const rec of app.findAllRecords("media_assets")) {
      if (rec.getString("status") === "held") {
        rec.set("status", "failed");
        app.save(rec);
      }
    }
    const col = app.findCollectionByNameOrId("media_assets");
    col.fields.getByName("status").values = P7_STATUS;
    app.save(col);
  },
);
