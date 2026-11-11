/// <reference path="../pb_data/types.d.ts" />
// DASH-22 (P11): CDS-wide announcements shown on Today ("From CDS"). A platform collection:
// no tenant field. `paths` is a string[] of site paths it targets (empty = every path).
// Written only by staff through the chokepoint. All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "platform_announcements",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "title", required: true, max: 80 },
        { type: "text", name: "body", max: 280 },
        { type: "text", name: "href", max: 300 },
        { type: "date", name: "starts_at", required: true },
        { type: "date", name: "ends_at" },
        { type: "json", name: "paths" },
        { type: "text", name: "created_by", max: 200 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_platform_announcements_window ON platform_announcements (starts_at, ends_at)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("platform_announcements"));
  },
);
