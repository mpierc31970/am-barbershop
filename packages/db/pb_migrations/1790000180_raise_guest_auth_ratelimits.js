/// <reference path="../pb_data/types.d.ts" />
// Review iteration-2 WR-03: every app sign-in reaches PB from the app server's IP, so PB's
// @guest `*:auth` rule (2 per 3 s) is one bucket for the whole platform: a single burst
// trips it for every user. The per-client limit now lives in the app
// (packages/db/src/rate-limit.ts: per IP and per account, failures only), so PB's guest
// auth rules become a platform-wide ceiling instead. Audience stays "@guest", so the app's
// superuser traffic is never throttled.
// The ceiling is safe only because the app is the only guest caller of the users auth
// endpoints: pb_hooks/users_auth_guard.pb.js refuses any request without the app key
// (review iteration-3 CR-01).
// down restores the state 1790000160 leaves on a PB 0.39.11 instance: `*:auth` at 2 per 3 s,
// and no `*:authWithOTP` / `*:requestOTP` rules.
const CEILING = { duration: 10, maxRequests: 60 };
const LABELS = ["*:auth", "*:authWithOTP", "*:requestOTP"];

function plainRules(settings) {
  const rules = [];
  for (const rule of settings.rateLimits.rules) {
    rules.push({
      label: rule.label,
      audience: rule.audience,
      duration: rule.duration,
      maxRequests: rule.maxRequests,
    });
  }
  return rules;
}

migrate(
  (app) => {
    const settings = app.settings();
    const rules = plainRules(settings);
    for (const label of LABELS) {
      let found = false;
      for (const r of rules) {
        if (r.label === label && r.audience === "@guest") {
          r.duration = CEILING.duration;
          r.maxRequests = CEILING.maxRequests;
          found = true;
        }
      }
      if (!found) {
        rules.push({
          label: label,
          audience: "@guest",
          duration: CEILING.duration,
          maxRequests: CEILING.maxRequests,
        });
      }
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
    for (const r of plainRules(settings)) {
      if (r.audience === "@guest" && r.label === "*:auth") {
        r.duration = 3;
        r.maxRequests = 2;
        rules.push(r);
      } else if (
        r.audience === "@guest" &&
        (r.label === "*:authWithOTP" || r.label === "*:requestOTP")
      ) {
        // added by up: drop
      } else {
        rules.push(r);
      }
    }
    unmarshal(
      { rateLimits: { enabled: settings.rateLimits.enabled, rules: rules } },
      settings,
    );
    app.save(settings);
  },
);
