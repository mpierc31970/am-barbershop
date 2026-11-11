/// <reference path="../pb_data/types.d.ts" />
// PAY-01 (review WR-E07 / WR-A06): the ledger can say "in progress". `claimed_at` is when a
// process took the event and `claim_id` which process. A claim is a lease: while it is
// fresh, a second process (another app instance, or the billing:reconcile CLI beside the
// app) does not run the handler at the same time; a crashed claim goes stale and the retry
// sweep picks the event up. Ids and times only, never a payload. All API rules stay null
// (invariant 1).
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("payment_events");
    col.fields.add(new DateField({ name: "claimed_at" }));
    col.fields.add(new TextField({ name: "claim_id", max: 32 }));
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("payment_events");
    col.fields.removeByName("claimed_at");
    col.fields.removeByName("claim_id");
    app.save(col);
  },
);
