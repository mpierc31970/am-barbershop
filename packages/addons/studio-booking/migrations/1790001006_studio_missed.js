// Studio Booking: a missed booking is a client who tried a time someone else had just taken.
// No booking row; just who wanted which time, so their barber can reach out (the hub alert
// `studio-booking.missed` points here by `missed:<id>`). All API rules null (invariant 1).
// Goes with its seat (cascade).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const seats = app.findCollectionByNameOrId("studio_seats");
    app.save(
      new Collection({
        type: "base",
        name: "studio_missed",
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
          { type: "text", name: "service_name", required: true, max: 80 },
          { type: "text", name: "starts_at", required: true, max: 30 },
          { type: "text", name: "client_name", required: true, max: 80 },
          { type: "text", name: "client_email", required: true, max: 254 },
          { type: "text", name: "client_phone", max: 30 },
          { type: "autodate", name: "created", onCreate: true },
          { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        ],
        indexes: [
          "CREATE INDEX idx_studio_missed_org_seat ON studio_missed (organization, seat)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("studio_missed"));
  },
);
