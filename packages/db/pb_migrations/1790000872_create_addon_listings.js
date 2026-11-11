/// <reference path="../pb_data/types.d.ts" />
// STAFF-07, D264 (P13-P6, P13-P7): add-on catalog listings authored from the staff console. A
// platform collection keyed by the add-on slug. The manifest stays the default and the source
// of behaviour and training (invariant 4); a listing only overrides tagline, description,
// screenshots, availability and sort. A manifest's private visibility always wins.
// screenshots is a json array of { id, object_key, alt, w, h }; the storage field is
// object_key, never key (secret regex, Pitfall 15). Files live in the platform ObjectStore at
// platform/catalog/<slug>/<id>.<ext> (P13-P21). availability's default (available) is applied
// in code. updated_by is a staff id (serverOnly). All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "addon_listings",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "slug", required: true, max: 64 },
        { type: "text", name: "tagline", max: 120 },
        { type: "text", name: "description", max: 2000 },
        { type: "json", name: "screenshots", maxSize: 20000 },
        {
          type: "select",
          name: "availability",
          maxSelect: 1,
          values: ["available", "coming_soon", "hidden"],
        },
        { type: "number", name: "sort", onlyInt: true },
        { type: "text", name: "updated_by", max: 15 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_addon_listings_slug ON addon_listings (slug)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("addon_listings"));
  },
);
