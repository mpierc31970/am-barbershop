/// <reference path="../pb_data/types.d.ts" />
// The sign-in code email's logo is centered, like every app-sent email (render/layout.ts).
// down restores the 1790000902 left-aligned line.
const LEFT_LINE =
  '<p style="margin:0 0 16px;"><a href="https://barber.needtobeedgy.com/" style="text-decoration:none;"><img src="https://barber.needtobeedgy.com/am-barber/logo.png" alt="A&amp;M Barber Studio" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;"></a></p>';
const CENTER_LINE =
  '<p style="margin:0 0 16px;text-align:center;" align="center"><a href="https://barber.needtobeedgy.com/" style="text-decoration:none;"><img src="https://barber.needtobeedgy.com/am-barber/logo.png" alt="A&amp;M Barber Studio" width="160" style="display:block;margin:0 auto;width:160px;max-width:100%;height:auto;border:0;"></a></p>';

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.otp.emailTemplate.body = users.otp.emailTemplate.body.replace(
      LEFT_LINE,
      CENTER_LINE,
    );
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.otp.emailTemplate.body = users.otp.emailTemplate.body.replace(
      CENTER_LINE,
      LEFT_LINE,
    );
    app.save(users);
  },
);
