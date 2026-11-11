/// <reference path="../pb_data/types.d.ts" />
// P11 (11-03; D275, DASH-08): page soft delete. deleted_at marks a page in the bin,
// deleted_by is the member id ("" for a system delete; server-only), delete_redirect_to is
// the page id its old address forwards to ("" = home). Index (organization, deleted_at) for
// the bin list and the live-pages filter. All API rules null (invariant 1).
const DELETED_INDEX =
  "CREATE INDEX idx_pages_org_deleted ON pages (organization, deleted_at)";

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("pages");
    col.fields.add(new DateField({ name: "deleted_at" }));
    col.fields.add(new TextField({ name: "deleted_by", max: 40 }));
    col.fields.add(new TextField({ name: "delete_redirect_to", max: 40 }));
    col.indexes = col.indexes.concat([DELETED_INDEX]);
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("pages");
    const kept = [];
    for (const idx of col.indexes) {
      if (!idx.includes("idx_pages_org_deleted")) kept.push(idx);
    }
    col.indexes = kept;
    col.fields.removeByName("deleted_at");
    col.fields.removeByName("deleted_by");
    col.fields.removeByName("delete_redirect_to");
    app.save(col);
  },
);
