/// <reference path="../pb_data/types.d.ts" />
// STAFF-17, D190 (P13-P6): per-site search indexing state. A platform collection with one row
// per site, keyed by org_id (text, unique), never a tenant relation field (P13-P5).
// last_ping_result records the SearchPinger outcome (the stand-in records "logged");
// sitemap_status comes from fetching the site's own /sitemap.xml through the app.
// pages_indexed stays unset until Search Console is connected (GO-LIVE); PocketBase reads an
// unset number as 0, so code treats it as unknown until sitemap/Search Console data exists.
// last_resubmit_by is a staff id. All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "org_indexing",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "org_id", required: true, max: 15 },
        { type: "date", name: "last_ping_at" },
        {
          type: "select",
          name: "last_ping_result",
          maxSelect: 1,
          values: ["logged", "ok", "error", "skipped"],
        },
        {
          type: "select",
          name: "sitemap_status",
          maxSelect: 1,
          values: ["ok", "error", "unchecked"],
        },
        { type: "date", name: "sitemap_checked_at" },
        { type: "number", name: "pages_indexed", onlyInt: true, min: 0 },
        { type: "date", name: "last_resubmit_at" },
        { type: "text", name: "last_resubmit_by", max: 15 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_org_indexing_org_id ON org_indexing (org_id)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("org_indexing"));
  },
);
