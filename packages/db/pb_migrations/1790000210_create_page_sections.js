/// <reference path="../pb_data/types.d.ts" />
// CONT-01 / D31 / D32 / CONTEXT A1-Q3: page_sections adopted field-for-field from the DCR
// donor (page_slug, section_type, row_layout, content, settings, sort_order, is_published,
// legacy_id), plus organization and a required page relation. section_type is TEXT, not a
// select: the section registry extends it at build time (invariant 5). All API rules null.
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const pages = app.findCollectionByNameOrId("pages");
    const collection = new Collection({
      type: "base",
      name: "page_sections",
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
          type: "relation",
          name: "page",
          required: true,
          collectionId: pages.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "text", name: "page_slug" },
        { type: "text", name: "section_type", required: true, max: 64 },
        { type: "text", name: "row_layout" },
        { type: "json", name: "content" },
        { type: "json", name: "settings" },
        { type: "number", name: "sort_order" },
        { type: "bool", name: "is_published" },
        { type: "text", name: "legacy_id" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_page_sections_org_page_sort ON page_sections (organization, page, sort_order)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("page_sections"));
  },
);
