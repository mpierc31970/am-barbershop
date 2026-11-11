// Studio Booking step 1 (D144, D145, D152): one row per barber seat and the seat's own
// service menu. All API rules null (invariant 1): every read and write goes through the
// @cds/db studio chokepoint, which narrows a barber (renter/staff member) to their own seat.
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const users = app.findCollectionByNameOrId("users");
    const seats = new Collection({
      type: "base",
      name: "studio_seats",
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
          name: "user",
          collectionId: users.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        { type: "text", name: "email", max: 254 },
        { type: "text", name: "name", required: true, max: 80 },
        { type: "text", name: "slug", required: true, max: 60 },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["renter", "staff"],
        },
        { type: "text", name: "headline", max: 120 },
        { type: "text", name: "bio", max: 2000 },
        { type: "text", name: "photo", max: 15 },
        { type: "json", name: "gallery", maxSize: 2000 },
        { type: "bool", name: "is_published" },
        { type: "number", name: "sort_order" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_studio_seats_org_slug ON studio_seats (organization, slug)",
        "CREATE INDEX idx_studio_seats_org_user ON studio_seats (organization, user)",
      ],
    });
    app.save(seats);

    const services = new Collection({
      type: "base",
      name: "studio_services",
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
          name: "seat",
          required: true,
          collectionId: seats.id,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { type: "text", name: "name", required: true, max: 80 },
        { type: "text", name: "description", max: 300 },
        { type: "number", name: "duration_minutes", onlyInt: true },
        { type: "number", name: "price_cents", onlyInt: true },
        { type: "number", name: "sort_order" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_studio_services_org_seat ON studio_services (organization, seat)",
      ],
    });
    app.save(services);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("studio_services"));
    app.delete(app.findCollectionByNameOrId("studio_seats"));
  },
);
