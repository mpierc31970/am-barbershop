/// <reference path="../pb_data/types.d.ts" />
// ONB-01, ONB-13 / D257 / CONTEXT A3-Q1: the business profile is the permanent home of the
// intake's business facts, one row per organization (unique index). Hours live here as core
// data, not add-on data (ONB-13, D257). P8 and Settings read the same record.
// All API rules null (invariant 1); every json field has an explicit maxSize (Pitfall 16).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "business_profile",
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
        { type: "text", name: "tagline", max: 80 },
        { type: "text", name: "business_type", max: 40 },
        { type: "text", name: "business_type_other", max: 80 },
        { type: "text", name: "description", max: 200 },
        { type: "text", name: "phone", max: 40 },
        { type: "email", name: "public_email" },
        { type: "json", name: "address", maxSize: 2000 },
        { type: "text", name: "service_area", max: 120 },
        { type: "text", name: "time_zone", max: 64 },
        { type: "json", name: "hours", maxSize: 8000 },
        { type: "json", name: "socials", maxSize: 4000 },
        { type: "text", name: "about", max: 2000 },
        { type: "text", name: "mission", max: 600 },
        { type: "text", name: "headline", max: 120 },
        { type: "text", name: "font_pairing", max: 40 },
        { type: "text", name: "ga4_id", max: 20 },
        { type: "text", name: "legal_name", max: 120 },
        { type: "email", name: "privacy_contact" },
        { type: "text", name: "legal_region", max: 80 },
        { type: "bool", name: "sending_domain_verified" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_business_profile_org ON business_profile (organization)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("business_profile"));
  },
);
