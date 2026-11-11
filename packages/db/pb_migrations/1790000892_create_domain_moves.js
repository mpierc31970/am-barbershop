/// <reference path="../pb_data/types.d.ts" />
// DOM-02, DOM-08 (14-08, P14-P2, P14-P30, P14-P33): the domain move state machine. One row per
// launch or post-launch move; seq gives the display code M-<seq> (unique). A platform
// collection: the site lives in org_id (text), never a tenant relation (P13-P5). to_host has
// no unique index (P14-P23). steps is the per-step json { key, status, at, attempts, ... }
// for snapshot, zone, gate, nameservers, delegation, site_records, edge, https, cutover,
// search; overrides is [{ rule, by, reason, at }]; acks is [{ key, by, at }]. primary_choice
// is written as apex unless the owner picks www (P14-P16). All API rules null (invariant 1);
// every field is serverOnly in BROWSER_FIELDS.
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "domain_moves",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "number", name: "seq", required: true, onlyInt: true, min: 1 },
        { type: "text", name: "org_id", required: true, max: 15 },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["launch", "move"],
        },
        { type: "text", name: "from_host", max: 253 },
        { type: "text", name: "to_host", required: true, max: 253 },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: [
            "running",
            "waiting_owner",
            "prepared",
            "cutover_running",
            "done",
            "failed",
            "cancelled",
          ],
        },
        { type: "text", name: "current_step", max: 20 },
        { type: "json", name: "steps", maxSize: 50000 },
        { type: "text", name: "failed_step", max: 20 },
        { type: "json", name: "overrides", maxSize: 10000 },
        { type: "json", name: "acks", maxSize: 5000 },
        {
          type: "select",
          name: "primary_choice",
          maxSelect: 1,
          values: ["apex", "www"],
        },
        { type: "text", name: "created_by", max: 15 },
        { type: "text", name: "cancel_reason", max: 500 },
        { type: "date", name: "prepared_at" },
        { type: "date", name: "done_at" },
        { type: "date", name: "cancelled_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_domain_moves_seq ON domain_moves (seq)",
        "CREATE INDEX idx_domain_moves_org_status ON domain_moves (org_id, status)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("domain_moves"));
  },
);
