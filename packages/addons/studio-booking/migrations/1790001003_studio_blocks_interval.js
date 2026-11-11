// Studio Booking: a barber blocks part of a day (time off with From/To; blank = whole day)
// and picks their own booking interval (slot_minutes; 0/blank = the 60-minute default).
migrate(
  (app) => {
    const off = app.findCollectionByNameOrId("studio_time_off");
    off.fields.add(new TextField({ name: "start_time", max: 5 }));
    off.fields.add(new TextField({ name: "end_time", max: 5 }));
    app.save(off);

    const seats = app.findCollectionByNameOrId("studio_seats");
    seats.fields.add(new NumberField({ name: "slot_minutes", onlyInt: true }));
    app.save(seats);
  },
  (app) => {
    const off = app.findCollectionByNameOrId("studio_time_off");
    off.fields.removeByName("start_time");
    off.fields.removeByName("end_time");
    app.save(off);
    const seats = app.findCollectionByNameOrId("studio_seats");
    seats.fields.removeByName("slot_minutes");
    app.save(seats);
  },
);
