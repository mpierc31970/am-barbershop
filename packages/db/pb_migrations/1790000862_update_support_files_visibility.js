/// <reference path="../pb_data/types.d.ts" />
// 12-REVIEW CR-A02 (T-12-04-01): support_files gains `visibility`, a copy of its message's
// visibility, so the registry rowFilter keeps files on internal staff notes out of the tenant's
// data download, the export bundle and repository reads. Existing rows are backfilled from
// their message; a row whose message is gone is "internal" (fail closed). All API rules stay
// null (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("support_files");
    col.fields.add(
      new SelectField({
        name: "visibility",
        maxSelect: 1,
        values: ["public", "internal"],
      }),
    );
    app.save(col);

    for (const rec of app.findAllRecords("support_files")) {
      let vis = "internal";
      const messageId = rec.getString("message");
      if (messageId) {
        try {
          const msg = app.findRecordById("support_messages", messageId);
          if (msg.getString("visibility") === "public") vis = "public";
        } catch (_) {
          vis = "internal";
        }
      }
      rec.set("visibility", vis);
      app.save(rec);
    }
  },
  (app) => {
    const col = app.findCollectionByNameOrId("support_files");
    col.fields.removeByName("visibility");
    app.save(col);
  },
);
