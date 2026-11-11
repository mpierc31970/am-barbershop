/// <reference path="../pb_data/types.d.ts" />
// STAFF-23 (13-06, P13-P6): content_flags gains the `queued` status (a scan that could not
// run during a provider outage waits for review:run to rescan it), a `source` select naming
// which scanner raised the flag (text, image, link or the composite scan) and a
// `rescan_attempts` counter. Down maps queued rows back to open first, then restores the P5
// status values and removes the two fields. All API rules stay null (invariant 1).
const P5_STATUS = ["open", "resolved"];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("content_flags");
    col.fields.getByName("status").values = P5_STATUS.concat(["queued"]);
    col.fields.add(
      new SelectField({
        name: "source",
        maxSelect: 1,
        required: false,
        values: ["text", "image", "link", "scan"],
      }),
    );
    col.fields.add(
      new NumberField({ name: "rescan_attempts", onlyInt: true, min: 0 }),
    );
    app.save(col);
  },
  (app) => {
    for (const rec of app.findAllRecords("content_flags")) {
      if (rec.getString("status") === "queued") {
        rec.set("status", "open");
        app.save(rec);
      }
    }
    const col = app.findCollectionByNameOrId("content_flags");
    col.fields.removeByName("source");
    col.fields.removeByName("rescan_attempts");
    col.fields.getByName("status").values = P5_STATUS;
    app.save(col);
  },
);
