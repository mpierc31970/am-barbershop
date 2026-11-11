/// <reference path="../pb_data/types.d.ts" />
// dev/test stand-in store; never read in production (14-10 refuses).
// DOM-03, DOM-08 (14-08, P14-P2, P14-P32): one row per domain in the fake DNS world (fake
// zones, records, public resolver answers, RDAP data, HTTPS probe results). Only the fake
// DnsProvider / resolver / prober read or write it; `/test-dns` (dev only) drives it. A
// platform collection with no org relation. All API rules null (invariant 1); every field
// is serverOnly in BROWSER_FIELDS.
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "dns_fake_state",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "domain", required: true, max: 253 },
        { type: "json", name: "data", maxSize: 200000 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_dns_fake_state_domain ON dns_fake_state (domain)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("dns_fake_state"));
  },
);
