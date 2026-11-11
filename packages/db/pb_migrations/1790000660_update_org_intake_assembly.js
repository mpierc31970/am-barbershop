/// <reference path="../pb_data/types.d.ts" />
// P8 (08-02): org_intake gains `assembly`, the automated-assembly ledger (CONTEXT A2-Q3;
// TMPL-02 idempotent, resumable provisioning). It holds statuses, ids, prints and slot lines
// only, never intake text. On the D187 export list (registry), so tenant exports include it.
// maxSize caps the ledger (T-08-02-02). All API rules unchanged (null; invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("org_intake");
    col.fields.add(new JSONField({ name: "assembly", maxSize: 200000 }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("org_intake");
    col.fields.removeByName("assembly");
    app.save(col);
  },
);
