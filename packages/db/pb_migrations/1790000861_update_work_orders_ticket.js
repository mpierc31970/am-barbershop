/// <reference path="../pb_data/types.d.ts" />
// COMM-06 (P12): work_orders gains ticket, the support ticket number a paid-work quote came
// from (0 = none), indexed for the ticket's paid-service view. All API rules stay null
// (invariant 1).
const TICKET_INDEX =
  "CREATE INDEX idx_work_orders_ticket ON work_orders (ticket)";

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("work_orders");
    col.fields.add(new NumberField({ name: "ticket", onlyInt: true, min: 0 }));
    col.indexes = col.indexes.concat([TICKET_INDEX]);
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("work_orders");
    const kept = [];
    for (const idx of col.indexes) {
      if (!idx.includes("idx_work_orders_ticket")) kept.push(idx);
    }
    col.indexes = kept;
    col.fields.removeByName("ticket");
    app.save(col);
  },
);
