// Studio Booking: online bookings start as `requested` (they hold the time) until the booked
// barber (or the owner) approves (`confirmed`) or declines (`declined`). Down maps both back
// to the old values first (requested -> confirmed, declined -> cancelled).
const BEFORE = ["confirmed", "cancelled", "completed", "no_show"];

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("studio_bookings");
    col.fields.getByName("status").values = BEFORE.concat([
      "requested",
      "declined",
    ]);
    app.save(col);
  },
  (app) => {
    const back = { requested: "confirmed", declined: "cancelled" };
    for (const rec of app.findAllRecords("studio_bookings")) {
      const to = back[rec.getString("status")];
      if (to) {
        rec.set("status", to);
        app.save(rec);
      }
    }
    const col = app.findCollectionByNameOrId("studio_bookings");
    col.fields.getByName("status").values = BEFORE;
    app.save(col);
  },
);
