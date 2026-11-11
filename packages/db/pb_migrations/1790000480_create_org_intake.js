/// <reference path="../pb_data/types.d.ts" />
// ONB-01 / CONTEXT A3-Q1: the intake's working state, one row per organization (unique
// index). Business facts do NOT live here; they go to their permanent homes
// (business_profile, team_members, services, media_assets). This row holds what only the
// intake needs: selections, per-add-on config, answers, the moodboard proposal and which
// stages are saved. addon_config has an explicit 4 MB cap (RESEARCH Pitfall 16).
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "org_intake",
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
        { type: "json", name: "selections", maxSize: 20000 },
        { type: "json", name: "addon_config", maxSize: 4000000 },
        { type: "json", name: "answers", maxSize: 4000 },
        { type: "json", name: "moodboard_proposal", maxSize: 20000 },
        { type: "json", name: "stages_saved", maxSize: 2000 },
        { type: "date", name: "first_visit_dismissed_at" },
        { type: "date", name: "submitted_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_org_intake_org ON org_intake (organization)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("org_intake"));
  },
);
