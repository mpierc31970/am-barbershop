/// <reference path="../pb_data/types.d.ts" />
// LIFE-01, D282, D263 (14-08, P14-P2, P14-P36): the offboarding record for a site leaving CDS.
// One row per site (org_id unique). A platform collection: the site lives in org_id (text),
// never a tenant relation (P13-P5). steps is the ordered step json (handback, data download,
// add-on items, subscription end, ...); reason_category is the owner's optional reason.
// requested_by is a user or staff id; requested_by_kind says which. All API rules null
// (invariant 1); every field is serverOnly in BROWSER_FIELDS.
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "offboardings",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "org_id", required: true, max: 15 },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["notice", "closed", "cancelled"],
        },
        { type: "text", name: "requested_by", max: 15 },
        {
          type: "select",
          name: "requested_by_kind",
          maxSelect: 1,
          values: ["owner", "staff"],
        },
        { type: "date", name: "requested_at" },
        { type: "date", name: "notice_ends_at" },
        { type: "json", name: "steps", maxSize: 50000 },
        {
          type: "select",
          name: "reason_category",
          maxSelect: 1,
          values: ["provider", "closing", "cost", "feature", "other"],
        },
        { type: "text", name: "note", max: 1000 },
        { type: "text", name: "cancel_reason", max: 500 },
        { type: "date", name: "cancelled_at" },
        { type: "date", name: "closed_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_offboardings_org_id ON offboardings (org_id)",
        "CREATE INDEX idx_offboardings_status ON offboardings (status)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("offboardings"));
  },
);
