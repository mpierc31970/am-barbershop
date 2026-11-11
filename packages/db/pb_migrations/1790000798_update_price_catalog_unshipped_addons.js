/// <reference path="../pb_data/types.d.ts" />
// BILL-18 (review WR-A02): the $0 Studio rows for Newsletter and Landing pages were seeded
// before either add-on exists, so every Studio org's entitlement set carried two keys with no
// package behind them. They sit inactive until the add-ons ship; `prices:set` (or staff in
// the admin UI) turns each back on with its package. Builder Pro's $0 Studio row stays.
// All API rules stay null.
const UNSHIPPED = ["newsletter", "landing-pages"];

function setActive(app, active) {
  for (const key of UNSHIPPED) {
    let row;
    try {
      row = app.findFirstRecordByFilter(
        "price_catalog",
        "item_kind = 'addon' && item_key = {:key} && path = 'studio'",
        { key },
      );
    } catch {
      continue;
    }
    row.set("active", active);
    app.save(row);
  }
}

migrate(
  (app) => setActive(app, false),
  (app) => setActive(app, true),
);
