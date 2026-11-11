/// <reference path="../pb_data/types.d.ts" />
// TEN-05 / D10 / D53: end_users is the tenant's own customers, a separate auth collection
// from platform `users` (never merged). Passwordless: OTP only, password auth disabled.
// Email is unique per organization, not globally (RESEARCH Pitfall 3): PB forces a
// single-column unique email index on auth collections, so it is replaced by a partial
// guard index that never matches (organization is required) plus the per-org index.
// Consequence: PB's public requestOTP is ambiguous here; end-user OTPs are minted by the
// chokepoint only. All API rules null (superuser only).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const collection = new Collection({
      type: "auth",
      name: "end_users",
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
      ],
      passwordAuth: { enabled: false },
      otp: { enabled: true, duration: 300, length: 6 },
    });
    app.save(collection);

    const saved = app.findCollectionByNameOrId("end_users");
    const kept = [];
    for (const idx of saved.indexes) {
      if (!idx.includes("idx_email_")) kept.push(idx);
    }
    kept.push(
      "CREATE UNIQUE INDEX idx_end_users_email_guard ON end_users (email) WHERE email != '' AND organization = ''",
      "CREATE UNIQUE INDEX idx_end_users_org_email ON end_users (organization, email) WHERE email != ''",
    );
    saved.indexes = kept;
    app.save(saved);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("end_users"));
  },
);
