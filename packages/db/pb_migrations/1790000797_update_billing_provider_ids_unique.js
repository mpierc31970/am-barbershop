/// <reference path="../pb_data/types.d.ts" />
// Invariant 1 (review WR-A01): webhooks and reconcile find the tenant of an event by its
// provider id (customer, subscription, Connect account, invoice), so each id may belong to
// one org only. Partial unique indexes (an empty id is "none yet") make the database refuse
// a second org holding the same id; the writers turn that refusal into a hard stop and a
// staff alert. Applying this fails loudly if duplicates already exist: resolve them first.
// All API rules stay null.
const BILLING_ACCOUNTS = [
  "CREATE UNIQUE INDEX idx_billing_accounts_customer ON billing_accounts (provider, customer_id) WHERE customer_id != ''",
  "CREATE UNIQUE INDEX idx_billing_accounts_subscription ON billing_accounts (provider, subscription_id) WHERE subscription_id != ''",
];
const GATEWAY_ACCOUNTS = [
  "CREATE UNIQUE INDEX idx_gateway_accounts_account ON gateway_accounts (provider, account_id) WHERE account_id != ''",
];
const BILLING_INVOICES = [
  "CREATE UNIQUE INDEX idx_billing_invoices_provider_id ON billing_invoices (provider, provider_invoice_id)",
];

function addIndexes(app, name, list) {
  const col = app.findCollectionByNameOrId(name);
  col.indexes = [...col.indexes, ...list];
  app.save(col);
}

/** Matched by index name: PocketBase may store the SQL normalised. */
function dropIndexes(app, name, list) {
  const names = list.map((sql) => sql.split(" ")[3]);
  const col = app.findCollectionByNameOrId(name);
  col.indexes = col.indexes.filter(
    (i) =>
      !names.some((n) => i.includes(` ${n} `) || i.includes("`" + n + "`")),
  );
  app.save(col);
}

migrate(
  (app) => {
    addIndexes(app, "billing_accounts", BILLING_ACCOUNTS);
    addIndexes(app, "gateway_accounts", GATEWAY_ACCOUNTS);
    addIndexes(app, "billing_invoices", BILLING_INVOICES);
  },
  (app) => {
    dropIndexes(app, "billing_accounts", BILLING_ACCOUNTS);
    dropIndexes(app, "gateway_accounts", GATEWAY_ACCOUNTS);
    dropIndexes(app, "billing_invoices", BILLING_INVOICES);
  },
);
