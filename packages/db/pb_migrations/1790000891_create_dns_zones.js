/// <reference path="../pb_data/types.d.ts" />
// DOM-03, DOM-05, DOM-08, LIFE-01 (14-08, P14-P2, P14-P23, P14-P39): the CDS DNS zone for a
// site's domain. A platform collection: the site lives in org_id (text), never a tenant
// relation field (P13-P5). Keyed by (org_id, domain); `domain` alone is not unique, so two
// orgs may hold parallel pending zones until the provider refuses (P14-P23).
// cds_keys is { cds: string[]; owner: string[] }: recordKeys of records CDS manages (CAA, site
// A/www, SES DKIM/MAIL FROM/DMARC) and CNAMEs the owner added. handback holds the handback
// destination, its nameservers, the reverse-check result and moved_away_at. The snapshot JSON
// itself lives in object storage at snapshot_key (P14-P24). All API rules null (invariant 1);
// every field is serverOnly in BROWSER_FIELDS.
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "dns_zones",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "org_id", required: true, max: 15 },
        { type: "text", name: "domain", required: true, max: 253 },
        {
          type: "select",
          name: "provider",
          maxSelect: 1,
          values: ["fake", "cloudflare"],
        },
        { type: "text", name: "provider_zone_id", max: 64 },
        {
          type: "select",
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["pending", "active", "moved", "handed_back", "deleted"],
        },
        { type: "json", name: "nameservers", maxSize: 2000 },
        { type: "json", name: "original_nameservers", maxSize: 2000 },
        { type: "text", name: "registrar", max: 120 },
        { type: "date", name: "expires_at" },
        {
          type: "select",
          name: "dnssec",
          maxSelect: 1,
          values: ["on", "off", "unknown"],
        },
        { type: "text", name: "snapshot_key", max: 300 },
        { type: "date", name: "snapshot_at" },
        { type: "text", name: "accepted_email_hash", max: 64 },
        { type: "date", name: "accepted_at" },
        { type: "date", name: "delegated_at" },
        { type: "json", name: "cds_keys", maxSize: 20000 },
        { type: "json", name: "handback", maxSize: 20000 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_dns_zones_org_id ON dns_zones (org_id)",
        "CREATE INDEX idx_dns_zones_domain ON dns_zones (domain)",
        "CREATE UNIQUE INDEX idx_dns_zones_org_domain ON dns_zones (org_id, domain)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("dns_zones"));
  },
);
