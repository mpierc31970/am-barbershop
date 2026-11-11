/// <reference path="../pb_data/types.d.ts" />
// AGR-01, D81, CONTEXT A1-Q2: immutable policy texts; hook refuses edits
// (pb_hooks/legal_append_only.pb.js). Platform collection: no organization. Only
// `status` may move active -> retired; a change is a new (key, version) row.
// `body_md` sets an explicit large max so long policies are never cut at the default.
// Nothing here is secret. All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "policy_versions",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "text",
          name: "key",
          required: true,
          pattern: "^[a-z0-9-]{2,40}$",
        },
        {
          type: "number",
          name: "version",
          required: true,
          onlyInt: true,
          min: 1,
        },
        { type: "text", name: "title", required: true, max: 200 },
        { type: "json", name: "summary", required: true, maxSize: 4000 },
        { type: "text", name: "changes", max: 400 },
        { type: "text", name: "body_md", required: true, max: 200000 },
        {
          type: "text",
          name: "sha256",
          required: true,
          pattern: "^[a-f0-9]{64}$",
        },
        { type: "date", name: "effective_at", required: true },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["active", "retired"],
        },
        { type: "bool", name: "draft" },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_policy_versions_key_version ON policy_versions (key, version)",
        "CREATE INDEX idx_policy_versions_status ON policy_versions (key, status)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    // Dropping a table skips the record delete hooks, so a down migration must never
    // destroy evidence: it refuses while any row exists (review IN-A05).
    const col = app.findCollectionByNameOrId("policy_versions");
    if (app.countRecords(col) > 0) {
      throw new Error(
        "policy_versions holds every signed version text; refusing to drop it (empty it through the retention job first)",
      );
    }
    app.delete(col);
  },
);
