/// <reference path="../pb_data/types.d.ts" />
// TEN-01 / TEN-04 / D54 / D57: org_hosts maps a hostname to its organization. `preview` is
// the <tenant>.sites.* preview host, `custom` the tenant's own domain. A hostname belongs to
// exactly one organization. All API rules null (superuser only).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "org_hosts",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "hostname", required: true },
        {
          type: "relation",
          name: "organization",
          required: true,
          collectionId: orgs.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: ["preview", "custom"],
        },
        { type: "bool", name: "primary" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_org_hosts_hostname ON org_hosts (hostname)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("org_hosts"));
  },
);
