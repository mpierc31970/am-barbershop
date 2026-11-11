/// <reference path="../pb_data/types.d.ts" />
// The sign-in code email (auth.code, sent by PB) gets the A&M logo at the top, like every
// app-sent email (render/layout.ts EMAIL_LOGO). down restores the 1790000430 body.
const BRAND_LINE =
  '<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#5B5B56;">Connections Design Studios</p>';
const LOGO_LINE =
  '<p style="margin:0 0 16px;"><a href="https://barber.needtobeedgy.com/" style="text-decoration:none;"><img src="https://barber.needtobeedgy.com/am-barber/logo.png" alt="A&amp;M Barber Studio" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;"></a></p>';

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.otp.emailTemplate.body = users.otp.emailTemplate.body.replace(
      BRAND_LINE,
      LOGO_LINE,
    );
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.otp.emailTemplate.body = users.otp.emailTemplate.body.replace(
      LOGO_LINE,
      BRAND_LINE,
    );
    app.save(users);
  },
);
