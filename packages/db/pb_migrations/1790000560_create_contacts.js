/// <reference path="../pb_data/types.d.ts" />
// CONTACTS-02, D236, D266: one contact per (organization, email_norm). The unique index is
// the merge-by-email backstop when two submits race. There is NO owner field: visibility is
// list membership (contact_lists + contact_list_members), so a renter context reading this
// collection through the generic repository gets Forbidden (RESEARCH Pitfall 11).
// `marketing_consent` is json {status none/unconfirmed/confirmed/withdrawn, at, source,
// wording, form}. `deleted_at` soft-deletes. This migration also adds
// `form_submissions.contact`. Nothing here is secret. All API rules null (invariant 1).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "base",
      name: "contacts",
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
        { type: "email", name: "email", required: true },
        { type: "text", name: "email_norm", required: true, max: 254 },
        { type: "text", name: "name", max: 120 },
        { type: "text", name: "phone", max: 40 },
        { type: "json", name: "tags" },
        {
          type: "select",
          name: "first_source",
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
        { type: "date", name: "last_seen_at" },
        { type: "json", name: "marketing_consent" },
        { type: "date", name: "deleted_at" },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_contacts_org_email_norm ON contacts (organization, email_norm)",
      ],
    });
    app.save(collection);

    const submissions = app.findCollectionByNameOrId("form_submissions");
    submissions.fields.add(
      new RelationField({
        name: "contact",
        required: false,
        collectionId: collection.id,
        maxSelect: 1,
        cascadeDelete: false,
      }),
    );
    app.save(submissions);
  },
  (app) => {
    const submissions = app.findCollectionByNameOrId("form_submissions");
    submissions.fields.removeByName("contact");
    app.save(submissions);
    app.delete(app.findCollectionByNameOrId("contacts"));
  },
);
