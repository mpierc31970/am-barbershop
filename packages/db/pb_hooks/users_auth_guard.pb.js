/// <reference path="../pb_data/types.d.ts" />
// Review iteration-3 CR-01: PB is publicly reachable, and its guest auth endpoints on
// `users` would let anyone skip the app's sign-in limits (packages/db/src/rate-limit.ts)
// and face only PB's platform-wide @guest ceiling (migration 1790000180). So the app is the
// only guest caller allowed: every guest request to users auth-with-password, request-otp
// or auth-with-otp must carry header X-CDS-App-Key equal to env PB_APP_KEY, which the
// app's guestClient() sends. Superuser requests are unaffected.
// Fail closed: when PB_APP_KEY is unset or empty on the PB container, every guest request
// to these endpoints is refused. Set the same PB_APP_KEY on the PB container and the app.
// PB JSVM handlers run in isolated VMs (no shared top-level helpers), so each handler
// repeats the same few lines.
onRecordAuthWithPasswordRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const key = $os.getenv("PB_APP_KEY");
    const sent = e.requestInfo().headers["x_cds_app_key"];
    if (!key || !sent || !$security.equal(sent, key)) {
      throw new ForbiddenError("sign in through the app");
    }
  }
  e.next();
}, "users");

onRecordRequestOTPRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const key = $os.getenv("PB_APP_KEY");
    const sent = e.requestInfo().headers["x_cds_app_key"];
    if (!key || !sent || !$security.equal(sent, key)) {
      throw new ForbiddenError("sign in through the app");
    }
  }
  e.next();
}, "users");

onRecordAuthWithOTPRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const key = $os.getenv("PB_APP_KEY");
    const sent = e.requestInfo().headers["x_cds_app_key"];
    if (!key || !sent || !$security.equal(sent, key)) {
      throw new ForbiddenError("sign in through the app");
    }
  }
  e.next();
}, "users");
