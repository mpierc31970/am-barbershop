// Studio Booking step 2 (D144, D149 reminders): each seat's weekly hours, whole-day time off
// and the bookings clients make online. All API rules null (invariant 1). Bookings and time
// off go with their seat (cascade): removing a barber removes their calendar.
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const seats = app.findCollectionByNameOrId("studio_seats");
    seats.fields.add(new JSONField({ name: "hours", maxSize: 4000 }));
    app.save(seats);

    const base = (name, fields, indexes) =>
      new Collection({
        type: "base",
        name,
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
          ...fields,
          { type: "autodate", name: "created", onCreate: true },
          { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
        ],
        indexes,
      });

    app.save(
      base(
        "studio_time_off",
        [
          { type: "text", name: "start_date", required: true, max: 10 },
          { type: "text", name: "end_date", required: true, max: 10 },
          { type: "text", name: "note", max: 120 },
        ],
        [
          "CREATE INDEX idx_studio_time_off_org_seat ON studio_time_off (organization, seat)",
        ],
      ),
    );

    app.save(
      base(
        "studio_bookings",
        [
          { type: "text", name: "reference", required: true, max: 12 },
          { type: "text", name: "service", max: 15 },
          { type: "text", name: "service_name", required: true, max: 80 },
          { type: "number", name: "duration_minutes", onlyInt: true },
          { type: "number", name: "price_cents", onlyInt: true },
          { type: "text", name: "starts_at", required: true, max: 30 },
          { type: "text", name: "ends_at", required: true, max: 30 },
          { type: "text", name: "client_name", required: true, max: 80 },
          { type: "text", name: "client_email", required: true, max: 254 },
          { type: "text", name: "client_phone", max: 30 },
          { type: "text", name: "note", max: 500 },
          {
            type: "select",
            name: "status",
            required: true,
            maxSelect: 1,
            values: ["confirmed", "cancelled", "completed", "no_show"],
          },
          { type: "bool", name: "reminder_sent" },
        ],
        [
          "CREATE INDEX idx_studio_bookings_org_seat_start ON studio_bookings (organization, seat, starts_at)",
          "CREATE INDEX idx_studio_bookings_org_start ON studio_bookings (organization, starts_at)",
        ],
      ),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("studio_bookings"));
    app.delete(app.findCollectionByNameOrId("studio_time_off"));
    const seats = app.findCollectionByNameOrId("studio_seats");
    seats.fields.removeByName("hours");
    app.save(seats);
  },
);
