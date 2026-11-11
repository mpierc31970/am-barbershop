/// <reference path="../pb_data/types.d.ts" />
// HUB-07, HUB-03 (15-03; P15-P2, P15-P14, A3-Q2): the CDS hub /contact form's inquiries. A
// platform collection: no organization field, so tenant scans (export, isolation, demo reset)
// never see these rows. ip_bucket is the sha256 hex of ipBucket(ip) (IPv6 cut to its /64),
// never the raw IP. Every field is serverOnly in BROWSER_FIELDS. Kept 730 days
// (HUB_INQUIRY_RETENTION_DAYS). All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "hub_inquiries",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "name", required: true, max: 100 },
        { type: "email", name: "email", required: true },
        { type: "text", name: "business", max: 120 },
        {
          type: "select",
          name: "topic",
          required: true,
          maxSelect: 1,
          values: ["question", "call", "press"],
        },
        { type: "text", name: "phone", max: 40 },
        { type: "text", name: "about", max: 60 },
        { type: "text", name: "message", required: true, max: 2000 },
        { type: "text", name: "ip_bucket", max: 64 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_hub_inquiries_created ON hub_inquiries (created)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("hub_inquiries"));
  },
);
