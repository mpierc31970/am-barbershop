// Studio Booking: a barber's own brand on their page: a shop/chair name, a logo (media id),
// social links ([{platform, url}]) and their TDLR license number.
migrate(
  (app) => {
    const seats = app.findCollectionByNameOrId("studio_seats");
    seats.fields.add(new TextField({ name: "brand_name", max: 80 }));
    seats.fields.add(new TextField({ name: "logo", max: 15 }));
    seats.fields.add(new JSONField({ name: "socials", maxSize: 4000 }));
    seats.fields.add(new TextField({ name: "license_number", max: 20 }));
    app.save(seats);
  },
  (app) => {
    const seats = app.findCollectionByNameOrId("studio_seats");
    for (const f of ["brand_name", "logo", "socials", "license_number"]) {
      seats.fields.removeByName(f);
    }
    app.save(seats);
  },
);
