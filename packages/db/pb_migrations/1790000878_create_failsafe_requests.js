/// <reference path="../pb_data/types.d.ts" />
// STAFF-14 (13-06, P13-P6, P13-P31, D155, D291): failsafe_requests holds booking requests the
// off-server fail-safe capture took while the main server was down, pulled in by health:run's
// failsafe-sync step. A tenant collection (organization relation; registry feature addons,
// writes custom, restore skip). `capture_id` is the capture service's id, unique per org, so
// a repeated pull never duplicates a request. Contact fields are AES-GCM ciphertext only in
// the fail-safe store; here they are plain fields behind the chokepoint. All API rules null
// (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "failsafe_requests",
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
        { type: "text", name: "addon", max: 64 },
        { type: "text", name: "capture_id", required: true, max: 40 },
        { type: "text", name: "name", max: 200 },
        { type: "email", name: "email" },
        { type: "text", name: "phone", max: 40 },
        { type: "text", name: "preferred", max: 500 },
        { type: "text", name: "message", max: 2000 },
        { type: "date", name: "captured_at" },
        {
          type: "select",
          name: "status",
          maxSelect: 1,
          values: ["pending", "converted", "dismissed"],
        },
        { type: "date", name: "converted_at" },
        { type: "text", name: "converted_ref", max: 64 },
        { type: "date", name: "dismissed_at" },
        { type: "text", name: "handled_by", max: 15 },
        { type: "date", name: "acked_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_failsafe_requests_org_status ON failsafe_requests (organization, status)",
        "CREATE UNIQUE INDEX idx_failsafe_requests_org_capture ON failsafe_requests (organization, capture_id)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("failsafe_requests"));
  },
);
