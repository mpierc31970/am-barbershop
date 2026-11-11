/// <reference path="../pb_data/types.d.ts" />
// CONTACTS-02, D236: a contact's history (form message, booking, subscribe, registration,
// purchase, import, manual). Append-only: there is no `updated` field. `ref` is the id of
// the source row. Nothing here is secret. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const contacts = app.findCollectionByNameOrId("contacts");
    const collection = new Collection({
      type: "base",
      name: "contact_events",
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
          name: "contact",
          required: true,
          collectionId: contacts.id,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          type: "select",
          name: "kind",
          required: true,
          maxSelect: 1,
          values: [
            "form",
            "booking",
            "subscribe",
            "registration",
            "purchase",
            "import",
            "manual",
          ],
        },
        { type: "text", name: "ref", max: 64 },
        { type: "text", name: "summary", max: 300 },
        { type: "date", name: "at", required: true },
        { type: "autodate", name: "created", onCreate: true },
      ],
      indexes: [
        "CREATE INDEX idx_contact_events_org_contact_at ON contact_events (organization, contact, at)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("contact_events"));
  },
);
