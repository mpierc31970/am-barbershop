/// <reference path="../pb_data/types.d.ts" />
// HUB-07 (15-REVIEW-part-B WR-B06): hub_inquiries drops `ip_bucket`. It held an unsalted
// sha256 of the IPv4 address (or IPv6 /64), which can be reversed by enumerating 2^32
// addresses, so it was effectively the IP, and nothing ever read it: the 5-per-hour contact
// limit is the in-memory contactLimiter. The privacy notice now says exactly that.
// Down restores the empty field only; dropped values are not recoverable (none are needed).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("hub_inquiries");
    col.fields.removeByName("ip_bucket");
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("hub_inquiries");
    col.fields.add(new TextField({ name: "ip_bucket", max: 64 }));
    app.save(col);
  },
);
