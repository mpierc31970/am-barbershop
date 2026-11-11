/// <reference path="../pb_data/types.d.ts" />
// COMM-12, CUSTOM-01 (P12): planned-work service windows. A platform collection: the site it
// targets lives in org_id (text), never a tenant relation field, so no tenant-collection scan
// mistakes it for a tenant row (P12-P12). seq gives the display code W-<seq> (P12-P6).
// alerted_at stamps the one cds.notice per window (P12-P8). created_by is the staff id
// (serverOnly in BROWSER_FIELDS). All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "service_windows",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "number", name: "seq", required: true, onlyInt: true, min: 1 },
        {
          type: "select",
          name: "scope",
          required: true,
          maxSelect: 1,
          values: ["platform", "addon", "organization", "page", "component"],
        },
        { type: "text", name: "org_id", max: 15 },
        { type: "text", name: "addon", max: 40 },
        { type: "text", name: "page", max: 15 },
        { type: "text", name: "component", max: 40 },
        { type: "text", name: "message", max: 280 },
        { type: "date", name: "starts_at", required: true },
        { type: "date", name: "ends_at", required: true },
        { type: "text", name: "incident", max: 15 },
        { type: "text", name: "created_by", max: 40 },
        { type: "date", name: "alerted_at" },
        { type: "date", name: "cleared_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_service_windows_seq ON service_windows (seq)",
        "CREATE INDEX idx_service_windows_window ON service_windows (starts_at, ends_at)",
        "CREATE INDEX idx_service_windows_org_id ON service_windows (org_id)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("service_windows"));
  },
);
