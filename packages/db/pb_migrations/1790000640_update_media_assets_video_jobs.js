/// <reference path="../pb_data/types.d.ts" />
// 07-13 (CONT-18, CONTEXT resolution e, UI-SPEC upload state "Waiting to optimize"): the video
// job state needs two columns besides `status`:
//   - video_attempts (int 0..2): incremented when a compression starts; at most two attempts
//   - processing_started_at (date): set when a compression starts, cleared when it ends; tells
//     "Waiting to optimize" from "Optimizing" and drives the stuck sweep
// Internal job state: never exported, never public, never restored (deny by default; no
// registry entry). All API rules stay null (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("media_assets");
    col.fields.add(
      new NumberField({
        name: "video_attempts",
        onlyInt: true,
        min: 0,
        max: 2,
      }),
    );
    col.fields.add(new DateField({ name: "processing_started_at" }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("media_assets");
    col.fields.removeByName("video_attempts");
    col.fields.removeByName("processing_started_at");
    app.save(col);
  },
);
