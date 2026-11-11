/// <reference path="../pb_data/types.d.ts" />
// CONT-28 / CONT-36, D275: pages gain the `system-404` kind (one per org, partial unique
// index; 07-32 owns the page), `version_refs` (json: the union of form, pop-up and media ids
// referenced by the retained versions, so a referenced item soft-deletes instead of
// vanishing) and `password_version` (bumped on every password change). Never exported:
// password_hash (T-03-08) and password_version (its name matches the secret pattern, and a
// restore resets it together with password_hash). All API rules null (invariant 1).
const SYSTEM_404_INDEX =
  "CREATE UNIQUE INDEX idx_pages_org_system404 ON pages (organization) WHERE kind = 'system-404'";

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("pages");
    col.fields.getByName("kind").values = ["builder", "system-404"];
    col.fields.add(new JSONField({ name: "version_refs" }));
    col.fields.add(
      new NumberField({ name: "password_version", onlyInt: true, min: 0 }),
    );
    col.indexes = col.indexes.concat([SYSTEM_404_INDEX]);
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("pages");
    col.fields.removeByName("version_refs");
    col.fields.removeByName("password_version");
    const kept = [];
    for (const idx of col.indexes) {
      if (!idx.includes("idx_pages_org_system404")) kept.push(idx);
    }
    col.indexes = kept;
    col.fields.getByName("kind").values = ["builder"];
    app.save(col);
  },
);
