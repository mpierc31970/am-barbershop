/// <reference path="../pb_data/types.d.ts" />
// COMM-11 (P12): the shared feature-ideas board. A platform collection (no tenant field):
// the suggesting site is kept in source_org (text) with source_thread, both serverOnly in
// BROWSER_FIELDS along with hold_reason. votes is the cached count of feature_idea_votes.
// hidden_at holds an idea back from the board; merged_into points at the idea it was merged
// into. All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "feature_ideas",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "title", max: 80 },
        { type: "text", name: "description", max: 2000 },
        {
          type: "select",
          name: "status",
          maxSelect: 1,
          values: ["suggested", "considering", "planned", "built"],
        },
        { type: "number", name: "votes", onlyInt: true, min: 0 },
        { type: "text", name: "source_org", max: 15 },
        { type: "text", name: "source_thread", max: 15 },
        { type: "date", name: "hidden_at" },
        { type: "text", name: "hold_reason", max: 60 },
        { type: "text", name: "merged_into", max: 15 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_feature_ideas_status_votes ON feature_ideas (status, votes)",
        "CREATE INDEX idx_feature_ideas_merged_into ON feature_ideas (merged_into)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("feature_ideas"));
  },
);
