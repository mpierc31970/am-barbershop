/// <reference path="../pb_data/types.d.ts" />
// STAFF-22, STAFF-18 (13-06, P13-P6, P13-P3): organizations gains `suspended_at` (a set date
// means the site answers 503), `suspension` json ({ mode, category, note, notice_sent_at,
// fix_by, fixed_at, lifted_at, by }) and `demo` (the CDS demo site: no mail, no billing, no
// alerts). Suspension is never a `status` value (P13-P3). Only staff and system functions
// write these; `suspension` and `demo` are serverOnly in BROWSER_FIELDS.
const ADDED = ["suspended_at", "suspension", "demo"];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    col.fields.add(new DateField({ name: "suspended_at" }));
    col.fields.add(new JSONField({ name: "suspension", maxSize: 20000 }));
    col.fields.add(new BoolField({ name: "demo" }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("organizations");
    for (const name of ADDED) col.fields.removeByName(name);
    app.save(col);
  },
);
