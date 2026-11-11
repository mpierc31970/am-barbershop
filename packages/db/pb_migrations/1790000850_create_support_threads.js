/// <reference path="../pb_data/types.d.ts" />
// COMM-01, COMM-02, COMM-04, SUPPORT-03 (P12): one row per support conversation or ticket.
// kind "conversation" is the org's single ongoing message thread (number 0); kind "ticket"
// carries a platform-wide ticket number (P12-P2). Partial unique indexes: ticket numbers are
// unique where number > 0, and each org has at most one conversation. Staff-only fields
// (context, opened_by_staff, assignee, priority, first_reply_due_at, sla_warned_at) are
// serverOnly in BROWSER_FIELDS. paid_service holds tenant-safe data only (P12-P7).
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const collection = new Collection({
      type: "base",
      name: "support_threads",
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
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["conversation", "ticket"],
        },
        { type: "number", name: "number", onlyInt: true, min: 0 },
        {
          type: "select",
          name: "type",
          maxSelect: 1,
          values: ["problem", "change", "question", "billing", "suggestion"],
        },
        { type: "text", name: "subject", max: 80 },
        {
          type: "select",
          name: "status",
          maxSelect: 1,
          values: [
            "open",
            "in_progress",
            "waiting_on_you",
            "resolved",
            "closed",
          ],
        },
        { type: "json", name: "target" },
        { type: "json", name: "context" },
        {
          type: "relation",
          name: "opened_by",
          required: false,
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "bool", name: "opened_by_cds" },
        { type: "text", name: "opened_by_staff", max: 40 },
        { type: "text", name: "assignee", max: 40 },
        {
          type: "select",
          name: "priority",
          maxSelect: 1,
          values: ["low", "normal", "high", "urgent"],
        },
        { type: "json", name: "paid_service" },
        { type: "text", name: "incident", max: 15 },
        { type: "date", name: "first_reply_due_at" },
        { type: "date", name: "first_replied_at" },
        { type: "date", name: "sla_warned_at" },
        { type: "date", name: "resolved_at" },
        { type: "date", name: "closed_at" },
        { type: "date", name: "last_activity_at" },
        { type: "date", name: "last_cds_activity_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_support_threads_number ON support_threads (number) WHERE number > 0",
        "CREATE UNIQUE INDEX idx_support_threads_conversation ON support_threads (organization) WHERE kind = 'conversation'",
        "CREATE INDEX idx_support_threads_org_list ON support_threads (organization, kind, status, last_activity_at)",
        "CREATE INDEX idx_support_threads_status_resolved ON support_threads (status, resolved_at)",
        "CREATE INDEX idx_support_threads_incident ON support_threads (incident)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("support_threads"));
  },
);
