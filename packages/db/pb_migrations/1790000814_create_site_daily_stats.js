/// <reference path="../pb_data/types.d.ts" />
// DASH-15 / DASH-16 (P11): first-party site metrics, one row per (day, path, source, device).
// `day` is YYYY-MM-DD in the business time zone; `path` is "" for org-level rows; `device`
// is m (mobile), t (tablet), c (computer) or "" (all). `conversions` counts form submissions
// attributed to the landing source. `vitals` holds fixed histograms. No visitor identifiers.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "site_daily_stats",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "relation",
          name: "organization",
          required: true,
          collectionId: orgs.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "text",
          name: "day",
          required: true,
          min: 10,
          max: 10,
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        { type: "text", name: "path", max: 300 },
        { type: "text", name: "source", max: 60 },
        {
          type: "select",
          name: "device",
          maxSelect: 1,
          values: ["m", "t", "c"],
        },
        { type: "number", name: "views", onlyInt: true, min: 0 },
        { type: "number", name: "not_found", onlyInt: true, min: 0 },
        { type: "number", name: "conversions", onlyInt: true, min: 0 },
        { type: "json", name: "vitals" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_site_daily_stats_key ON site_daily_stats (organization, day, path, source, device)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("site_daily_stats"));
  },
);
