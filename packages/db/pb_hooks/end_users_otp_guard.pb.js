/// <reference path="../pb_data/types.d.ts" />
// WR-06 / D10 / D53: end_users email is unique per organization, not globally, so PB's public
// request-otp / auth-with-otp endpoints would resolve an email to an arbitrary org's record
// (a customer of org B could receive a login for org A). End-user OTPs are minted by the
// chokepoint only, through the superuser client, so every non-superuser request to either
// endpoint on end_users is refused here.
onRecordRequestOTPRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    throw new ForbiddenError("end-user sign-in goes through the site");
  }
  e.next();
}, "end_users");

onRecordAuthWithOTPRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    throw new ForbiddenError("end-user sign-in goes through the site");
  }
  e.next();
}, "end_users");
