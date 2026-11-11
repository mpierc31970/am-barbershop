/// <reference path="../pb_data/types.d.ts" />
// DOM-10, D172 (14-09, P14-P2): launch_review_marks holds the owner's walk-through of the
// built site before launch: one row per page mark ("Looks good" / "Needs a change") and one
// per checklist item (key facts, phone check, test form) plus the `submitted` row. A tenant
// collection (organization relation; registry feature launch_review, writes custom, restore
// skip). `page` is empty for non-page kinds; `page_version` is the page's published version
// stamp when marked, so a later edit can reopen the mark. `by` is a member id (kept out of
// exports); `note_ticket` is the P12 ticket number opened for a needs_change mark.
// All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "launch_review_marks",
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
          values: [
            "page",
            "key_facts",
            "phone_check",
            "test_form",
            "submitted",
          ],
        },
        { type: "text", name: "page", max: 15 },
        {
          type: "select",
          name: "status",
          maxSelect: 1,
          values: ["looks_good", "needs_change", "done"],
        },
        { type: "text", name: "page_version", max: 40 },
        { type: "text", name: "by", max: 15 },
        { type: "date", name: "at" },
        { type: "number", name: "note_ticket", onlyInt: true, min: 0 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_launch_review_marks_org_kind_page ON launch_review_marks (organization, kind, page)",
        "CREATE INDEX idx_launch_review_marks_org_kind ON launch_review_marks (organization, kind)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("launch_review_marks"));
  },
);
