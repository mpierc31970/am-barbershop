/// <reference path="../pb_data/types.d.ts" />
// COMM-11 (P12): one vote per site per idea, enforced by the unique (organization, idea)
// index. voted_by is the member who cast it (optional, so removing a person keeps the
// site's vote). All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const ideas = app.findCollectionByNameOrId("feature_ideas");
    const collection = new Collection({
      type: "base",
      name: "feature_idea_votes",
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
          type: "relation",
          name: "idea",
          required: true,
          collectionId: ideas.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "relation",
          name: "voted_by",
          required: false,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_feature_idea_votes_org_idea ON feature_idea_votes (organization, idea)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("feature_idea_votes"));
  },
);
