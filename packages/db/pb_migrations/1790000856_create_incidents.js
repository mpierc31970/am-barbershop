/// <reference path="../pb_data/types.d.ts" />
// COMM-12, SUPPORT-03 (P12): platform incidents. A platform collection (no tenant field).
// seq gives the display code I-<seq> (P12-P6); public_text is what owners see; tickets and
// service windows link by incident id. created_by is the staff id (serverOnly in
// BROWSER_FIELDS). All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "incidents",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "number", name: "seq", required: true, onlyInt: true, min: 1 },
        { type: "text", name: "title", max: 80 },
        { type: "text", name: "public_text", max: 2000 },
        {
          type: "select",
          name: "status",
          maxSelect: 1,
          values: ["open", "resolved"],
        },
        { type: "date", name: "resolved_at" },
        { type: "text", name: "created_by", max: 40 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_incidents_seq ON incidents (seq)"],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("incidents"));
  },
);
