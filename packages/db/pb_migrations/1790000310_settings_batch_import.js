/// <reference path="../pb_data/types.d.ts" />
// ADDON-06 / RESEARCH Pattern 8, Pitfall 3: a 2,000-row CSV import commits as one PB batch,
// so the batch limit rises from 1000 requests / 30 s to 5000 / 60 s. Touches batch.* only.
// down restores the values set by 1790000160_settings_batch_ratelimits.js.
migrate(
  (app) => {
    const settings = app.settings();
    settings.batch.maxRequests = 5000;
    settings.batch.timeout = 60;
    app.save(settings);
  },
  (app) => {
    const settings = app.settings();
    settings.batch.maxRequests = 1000;
    settings.batch.timeout = 30;
    app.save(settings);
  },
);
