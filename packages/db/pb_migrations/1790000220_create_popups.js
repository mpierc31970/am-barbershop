/// <reference path="../pb_data/types.d.ts" />
// CONT-11 / CONTEXT A3-Q4: site pop-ups. content is a columns-block payload; trigger,
// frequency and show_on decide when a visitor sees it. page_ids lists the pages for
// show_on = selected-pages. All API rules null (superuser only; invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "popups",
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
        { type: "text", name: "name", required: true, max: 80 },
        { type: "json", name: "content" },
        {
          type: "select",
          name: "trigger",
          maxSelect: 1,
          values: ["click", "delay", "scroll", "exit-intent", "page-load"],
        },
        { type: "number", name: "delay_seconds" },
        { type: "number", name: "scroll_percent" },
        {
          type: "select",
          name: "frequency",
          maxSelect: 1,
          values: ["every-visit", "once-per-session", "once-per-visitor"],
        },
        {
          type: "select",
          name: "show_on",
          maxSelect: 1,
          values: ["button-only", "all-pages", "selected-pages"],
        },
        { type: "json", name: "page_ids" },
        { type: "bool", name: "enabled" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX idx_popups_org ON popups (organization)"],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("popups"));
  },
);
