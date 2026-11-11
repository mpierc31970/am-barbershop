// Studio Booking step 3 (D152, D162 fixed rent): one lease per chair (rent, cadence, next
// due date) and the owner's hand-kept payment log. All API rules null (invariant 1). Both go
// with their seat (cascade).
migrate(
  (app) => {
    const orgs = app.findCollectionByNameOrId("organizations");
    const seats = app.findCollectionByNameOrId("studio_seats");
    const owned = (cascade) => [
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
        name: "seat",
        required: true,
        collectionId: seats.id,
        maxSelect: 1,
        cascadeDelete: cascade,
      },
    ];
    const rules = {
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    };
    const stamps = [
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ];

    app.save(
      new Collection({
        type: "base",
        name: "studio_leases",
        ...rules,
        fields: [
          ...owned(true),
          { type: "number", name: "rent_cents", onlyInt: true },
          {
            type: "select",
            name: "cadence",
            required: true,
            maxSelect: 1,
            values: ["weekly", "biweekly", "monthly"],
          },
          { type: "text", name: "next_due", required: true, max: 10 },
          { type: "bool", name: "active" },
          { type: "text", name: "overdue_alerted", max: 10 },
          ...stamps,
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_studio_leases_org_seat ON studio_leases (organization, seat)",
        ],
      }),
    );

    app.save(
      new Collection({
        type: "base",
        name: "studio_lease_payments",
        ...rules,
        fields: [
          ...owned(true),
          { type: "number", name: "amount_cents", onlyInt: true },
          { type: "text", name: "paid_on", required: true, max: 10 },
          { type: "text", name: "period_due", required: true, max: 10 },
          { type: "text", name: "note", max: 120 },
          ...stamps,
        ],
        indexes: [
          "CREATE INDEX idx_studio_lease_payments_org_seat ON studio_lease_payments (organization, seat, period_due)",
        ],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("studio_lease_payments"));
    app.delete(app.findCollectionByNameOrId("studio_leases"));
  },
);
