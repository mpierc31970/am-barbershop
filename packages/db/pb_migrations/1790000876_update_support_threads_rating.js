/// <reference path="../pb_data/types.d.ts" />
// STAFF-21 (13-06, P13-P6, P13-P18, P13-P32, D212): support_threads gains the one rating per
// ticket: `rating` up/down, `rating_comment` (max 500), `rated_at`, `rated_by` (member id),
// `rated_agent` (staff id credited: assignee at resolve, else last public staff replier) and
// `rating_followed_at` (staff marked a thumbs-down followed up). rated_by, rated_agent and
// rating_followed_at are serverOnly and never exported. Index (rating, rated_at) feeds
// Ratings & SLA. All API rules stay null (invariant 1).
const ADDED = [
  "rating",
  "rating_comment",
  "rated_at",
  "rated_by",
  "rated_agent",
  "rating_followed_at",
];
const RATING_INDEX =
  "CREATE INDEX idx_support_threads_rating ON support_threads (rating, rated_at)";

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("support_threads");
    col.fields.add(
      new SelectField({
        name: "rating",
        maxSelect: 1,
        required: false,
        values: ["up", "down"],
      }),
    );
    col.fields.add(new TextField({ name: "rating_comment", max: 500 }));
    col.fields.add(new DateField({ name: "rated_at" }));
    col.fields.add(new TextField({ name: "rated_by", max: 15 }));
    col.fields.add(new TextField({ name: "rated_agent", max: 15 }));
    col.fields.add(new DateField({ name: "rating_followed_at" }));
    col.indexes = col.indexes.concat([RATING_INDEX]);
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("support_threads");
    const kept = [];
    for (const idx of col.indexes) {
      if (!idx.includes("idx_support_threads_rating")) kept.push(idx);
    }
    col.indexes = kept;
    for (const name of ADDED) col.fields.removeByName(name);
    app.save(col);
  },
);
