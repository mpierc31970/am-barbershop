/// <reference path="../pb_data/types.d.ts" />
// ONB-12 / UI-SPEC Emails `auth.code`: the sign-in code email for platform users (owners who
// sign in with "Email me a sign-in code", and staff MFA). PB sends it (sentBy "pb" in the
// email class table). OTP stays 6 digits, 5 minutes (1790000110). Inline styles only, no
// images: #1B1B19 ink on a #FFFFFF card on a #F2F2EF ground.
// down restores the PB 0.39.11 default template, captured 2026-09-28 from a scratch instance
// (users.otp.emailTemplate read in a throwaway migration), so the round trip stays green.
const SUBJECT = "Your sign-in code";
const BODY = [
  "<div style=\"margin:0;padding:32px 16px;background:#F2F2EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1B1B19;\">",
  '<div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:8px;padding:32px;">',
  '<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#5B5B56;">Connections Design Studios</p>',
  '<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;color:#1B1B19;">Your sign-in code</h1>',
  '<p style="margin:0 0 8px;font-size:16px;line-height:1.5;color:#1B1B19;">Your code is</p>',
  '<p style="margin:0 0 24px;font-size:28px;line-height:1.2;font-weight:600;letter-spacing:0.25em;color:#1B1B19;">{OTP}</p>',
  '<p style="margin:0;font-size:16px;line-height:1.5;color:#1B1B19;">It expires in 5 minutes. If you didn\'t ask for it, you can ignore this email.</p>',
  "</div>",
  "</div>",
].join("\n");

// PB 0.39.11 default (captured 2026-09-28 from PB 0.39.11).
const DEFAULT_SUBJECT = "OTP for {APP_NAME}";
const DEFAULT_BODY =
  "<p>Hello,</p>\n<p>Your one-time password is: <strong>{OTP}</strong></p>\n<p><i>If you didn't ask for the one-time password, you can ignore this email.</i></p>\n<p>\n  Thanks,<br/>\n  {APP_NAME} team\n</p>";

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.otp.emailTemplate.subject = SUBJECT;
    users.otp.emailTemplate.body = BODY;
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.otp.emailTemplate.subject = DEFAULT_SUBJECT;
    users.otp.emailTemplate.body = DEFAULT_BODY;
    app.save(users);
  },
);
