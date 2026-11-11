/// <reference path="../pb_data/types.d.ts" />
// STAFF-24, STAFF-23, D248, D249 (P13-P6, P13-P8): review cases for spot checks, public reports
// and DMCA notices. A platform collection: one case sequence, seq gives the display code
// R-<seq>. The site lives in org_id (text), never a tenant relation field, so tenant scans
// (export, isolation, demo reset) never see these rows (P13-P5). Scan flags and holds are read
// from content_flags / held items, never copied here (P13-P8).
// steps is the timeline json [{ step, at, by, note? }]; pages lists a spot check's changed
// pages [{ page_id, title, state }]; dmca_statement holds the DMCA attestations
// { good_faith, accuracy, signature, signed_at }. reporter_name / reporter_email (DMCA
// contact) and created_by are serverOnly in BROWSER_FIELDS. All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "review_cases",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "number", name: "seq", required: true, onlyInt: true, min: 1 },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["spot_check", "report", "dmca"],
        },
        { type: "text", name: "org_id", max: 15 },
        { type: "text", name: "target_url", max: 2000 },
        { type: "text", name: "target_collection", max: 64 },
        { type: "text", name: "target_id", max: 15 },
        {
          type: "select",
          name: "category",
          maxSelect: 1,
          values: ["copyright", "scam", "illegal", "other", "spot_check"],
        },
        { type: "text", name: "description", max: 5000 },
        { type: "text", name: "reporter_name", max: 200 },
        { type: "email", name: "reporter_email" },
        { type: "json", name: "dmca_statement", maxSize: 5000 },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["open", "waiting", "closed"],
        },
        { type: "json", name: "steps", maxSize: 100000 },
        { type: "date", name: "due_at" },
        { type: "text", name: "assignee", max: 15 },
        {
          type: "select",
          name: "outcome",
          maxSelect: 1,
          values: [
            "cleared",
            "fix_requested",
            "removed",
            "suspended",
            "upheld",
            "restored",
            "rejected",
          ],
        },
        { type: "json", name: "pages", maxSize: 50000 },
        { type: "text", name: "created_by", max: 15 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_review_cases_seq ON review_cases (seq)",
        "CREATE INDEX idx_review_cases_org_id ON review_cases (org_id)",
        "CREATE INDEX idx_review_cases_kind ON review_cases (kind)",
        "CREATE INDEX idx_review_cases_status ON review_cases (status)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("review_cases"));
  },
);
