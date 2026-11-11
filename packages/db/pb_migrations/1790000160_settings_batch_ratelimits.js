/// <reference path="../pb_data/types.d.ts" />
// RESEARCH Pitfalls 4/5, Open Question 3: enable the batch API (atomic restore and ownership
// transfer) and PB's auth rate limits. Only the `*:auth` rule is kept, audience "@guest", so
// the app's superuser traffic is never throttled. Settings, not a collection: no API rules.
// down restores the PB 0.39.11 defaults captured from a scratch instance (GET /api/settings).
migrate(
  (app) => {
    const settings = app.settings();
    settings.batch.enabled = true;
    settings.batch.maxRequests = 1000;
    settings.batch.timeout = 30;

    const authRules = [];
    for (const rule of settings.rateLimits.rules) {
      const label = rule.label;
      if (
        label.endsWith(":auth") ||
        label.endsWith(":requestOTP") ||
        label.endsWith(":authWithOTP")
      ) {
        authRules.push({
          label: label,
          audience: "@guest",
          duration: rule.duration,
          maxRequests: rule.maxRequests,
        });
      }
    }
    if (authRules.length === 0) {
      authRules.push({
        label: "*:auth",
        audience: "@guest",
        duration: 3,
        maxRequests: 2,
      });
    }
    unmarshal({ rateLimits: { enabled: true, rules: authRules } }, settings);
    app.save(settings);
  },
  (app) => {
    // PB 0.39.11 default rate-limit rules (captured 2026-09-26).
    const DEFAULT_RULES = [
      { label: "*:auth", audience: "", duration: 3, maxRequests: 2 },
      { label: "*:create", audience: "", duration: 5, maxRequests: 20 },
      { label: "/api/batch", audience: "", duration: 1, maxRequests: 3 },
      { label: "/api/", audience: "", duration: 10, maxRequests: 300 },
    ];
    const settings = app.settings();
    settings.batch.enabled = false;
    settings.batch.maxRequests = 50;
    settings.batch.timeout = 3;
    unmarshal(
      { rateLimits: { enabled: false, rules: DEFAULT_RULES } },
      settings,
    );
    app.save(settings);
  },
);
