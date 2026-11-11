/// <reference path="../pb_data/types.d.ts" />
// BILL-14 / D233 (10-36): the form's Forms Pro settings (show/hide rules, steps, auto-reply,
// answer routing, save and finish later) as one json value, validated by the forms writer
// (10-34). Kept when Builder Pro lapses and ignored while inactive (invariant 9). Visitors
// never read it raw: the public form carries only rules, steps and the save flag while Pro is
// active (T-10-36-04). All API rules stay null (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("forms");
    col.fields.add(new JSONField({ name: "pro", maxSize: 200000 }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("forms");
    col.fields.removeByName("pro");
    app.save(col);
  },
);
