/// <reference path="../pb_data/types.d.ts" />
// CONT-19 / CONT-20 / CONT-33 / CONT-36, D255, D220, D275: media_assets grows into the P7
// media library. New kinds (library, video, audio), sources (library, link = a provider
// thumbnail, 07-23) and extensions (mp4, mp3). `status` + `public_at` gate public serving
// (only promoted, ready assets are public). `deleted_at` soft-deletes a referenced item
// (distinct from P6's `removed_at`, which intake keeps using). `poster_asset` is a TEXT
// media_assets id, deliberately not a self-relation, so the export restore's in-collection
// upsert order can never fail. `captions_path` is the captions variant file name relative to
// the asset's media folder (`captions.vtt`), never a full storage key; keys are always built
// from the row by keys.ts (07-09). Never exported: nothing new (storage_dir stays non-public).
// Existing rows are backfilled to status `ready`. All API rules null (invariant 1).
const P6_KINDS = ["logo", "hero", "gallery", "team", "moodboard"];
const P6_SOURCES = ["intake"];
const P6_EXTS = ["jpg", "png", "webp"];
const ADDED = [
  "status",
  "public_at",
  "deleted_at",
  "poster_asset",
  "duration_s",
  "captions_path",
];
const STATUS_INDEX =
  "CREATE INDEX idx_media_assets_org_status ON media_assets (organization, status)";

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("media_assets");
    col.fields.getByName("kind").values = P6_KINDS.concat([
      "library",
      "video",
      "audio",
    ]);
    col.fields.getByName("source").values = ["intake", "library", "link"];
    col.fields.getByName("original_ext").values = P6_EXTS.concat([
      "mp4",
      "mp3",
    ]);
    col.fields.add(
      new SelectField({
        name: "status",
        maxSelect: 1,
        required: false,
        values: ["uploading", "processing", "ready", "failed"],
      }),
    );
    col.fields.add(new DateField({ name: "public_at" }));
    col.fields.add(new DateField({ name: "deleted_at" }));
    col.fields.add(new TextField({ name: "poster_asset", max: 32 }));
    col.fields.add(
      new NumberField({ name: "duration_s", onlyInt: true, min: 0 }),
    );
    col.fields.add(new TextField({ name: "captions_path", max: 64 }));
    col.indexes = col.indexes.concat([STATUS_INDEX]);
    app.save(col);

    for (const rec of app.findAllRecords("media_assets")) {
      if (!rec.get("status")) {
        rec.set("status", "ready");
        app.save(rec);
      }
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId("media_assets");
    for (const name of ADDED) col.fields.removeByName(name);
    const kept = [];
    for (const idx of col.indexes) {
      if (!idx.includes("idx_media_assets_org_status")) kept.push(idx);
    }
    col.indexes = kept;
    col.fields.getByName("kind").values = P6_KINDS;
    col.fields.getByName("source").values = P6_SOURCES;
    col.fields.getByName("original_ext").values = P6_EXTS;
    app.save(col);
  },
);
