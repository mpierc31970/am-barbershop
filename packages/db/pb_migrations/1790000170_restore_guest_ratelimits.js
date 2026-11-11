/// <reference path="../pb_data/types.d.ts" />
// WR-01: 1790000160 kept only the auth rate-limit rules, which dropped PocketBase's default
// `/api/` and `*:create` limits. PB is publicly reachable (api.cds…), so those defaults come
// back for guests. Audience "@guest" keeps the app's superuser traffic unthrottled. The real
// per-client sign-in limit is enforced in the app (packages/db/src/rate-limit.ts), because
// every app-origin request reaches PB from the app server's IP.
// down removes exactly the rules this migration adds.
const GUEST_DEFAULTS = [
  { label: "*:create", audience: "@guest", duration: 5, maxRequests: 20 },
  { label: "/api/", audience: "@guest", duration: 10, maxRequests: 300 },
];

migrate(
  (app) => {
    const settings = app.settings();
    const rules = [];
    for (const rule of settings.rateLimits.rules) {
      rules.push({
        label: rule.label,
        audience: rule.audience,
        duration: rule.duration,
        maxRequests: rule.maxRequests,
      });
    }
    for (const add of GUEST_DEFAULTS) {
      let present = false;
      for (const r of rules) {
        if (r.label === add.label && r.audience === add.audience)
          present = true;
      }
      if (!present) rules.push(add);
    }
    unmarshal(
      { rateLimits: { enabled: settings.rateLimits.enabled, rules: rules } },
      settings,
    );
    app.save(settings);
  },
  (app) => {
    const settings = app.settings();
    const rules = [];
    for (const rule of settings.rateLimits.rules) {
      let added = false;
      for (const g of GUEST_DEFAULTS) {
        if (rule.label === g.label && rule.audience === g.audience)
          added = true;
      }
      if (!added) {
        rules.push({
          label: rule.label,
          audience: rule.audience,
          duration: rule.duration,
          maxRequests: rule.maxRequests,
        });
      }
    }
    unmarshal(
      { rateLimits: { enabled: settings.rateLimits.enabled, rules: rules } },
      settings,
    );
    app.save(settings);
  },
);
