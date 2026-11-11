/// <reference path="../pb_data/types.d.ts" />
// COMM-01 (P12): member_prefs gains support_read, a per-person map of thread id -> last read
// time, for unread counts in Support. All API rules stay null (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("member_prefs");
    col.fields.add(new JSONField({ name: "support_read" }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("member_prefs");
    col.fields.removeByName("support_read");
    app.save(col);
  },
);
