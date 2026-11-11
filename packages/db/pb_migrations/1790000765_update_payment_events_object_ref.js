/// <reference path="../pb_data/types.d.ts" />
// PAY-01 (10-09): the provider object id an event points at (checkout session, invoice,
// subscription, Connect account, customer). The ledger stores ids only, never a payload, so
// this is what lets the retry sweep rebuild a failed event and run it again (RESEARCH
// Pitfall 1). Plain text, not secret. All API rules stay null (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("payment_events");
    col.fields.add(new TextField({ name: "object_ref", max: 255 }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("payment_events");
    col.fields.removeByName("object_ref");
    app.save(col);
  },
);
