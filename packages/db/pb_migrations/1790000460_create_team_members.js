/// <reference path="../pb_data/types.d.ts" />
// ONB-13 / D257 / CONTEXT A3-Q1: the team is core data, not add-on data. One row per person,
// ordered by sort_order; `photo` points at a media_assets row (kind team). The Our Team block
// reads these. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const media = app.findCollectionByNameOrId("media_assets");
    const collection = new Collection({
      type: "base",
      name: "team_members",
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
        { type: "text", name: "name", required: true, max: 120 },
        { type: "text", name: "role", max: 120 },
        { type: "text", name: "bio", max: 600 },
        {
          type: "relation",
          name: "photo",
          collectionId: media.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "number", name: "sort_order", onlyInt: true },
        { type: "bool", name: "is_published" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_team_members_org_sort ON team_members (organization, sort_order)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("team_members"));
  },
);
