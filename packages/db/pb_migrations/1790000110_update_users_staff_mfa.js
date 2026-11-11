/// <reference path="../pb_data/types.d.ts" />
// TEN-05 / D10: the default `users` auth collection holds platform users (CDS staff and org
// members). It already exists, so it is altered, never created (RESEARCH Pitfall 1).
// staff_role marks CDS staff; MFA (password + OTP) is required for any staff account.
// All API rules null (superuser only). authRule stays unchanged: members and staff still
// authenticate through PB's auth endpoints, driven by the chokepoint.
// down restores the PB 0.39.11 defaults captured from a scratch instance, so the
// up/down/up round trip stays green.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(
      new SelectField({
        name: "staff_role",
        maxSelect: 1,
        required: false,
        values: ["super_admin", "support_agent"],
      }),
    );
    users.mfa.enabled = true;
    users.mfa.rule = "staff_role != ''";
    users.otp.enabled = true;
    users.otp.duration = 300;
    users.otp.length = 6;
    users.listRule = null;
    users.viewRule = null;
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;
    app.save(users);
  },
  (app) => {
    // PB 0.39.11 default `users` values (captured 2026-09-26 via GET /api/collections/users).
    const ORIGINAL_RULES = {
      listRule: "id = @request.auth.id",
      viewRule: "id = @request.auth.id",
      createRule: "",
      updateRule: "id = @request.auth.id",
      deleteRule: "id = @request.auth.id",
    };
    const ORIGINAL_MFA = { enabled: false, duration: 600, rule: "" };
    const ORIGINAL_OTP = { enabled: false, duration: 180, length: 8 };

    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("staff_role");
    users.listRule = ORIGINAL_RULES.listRule;
    users.viewRule = ORIGINAL_RULES.viewRule;
    users.createRule = ORIGINAL_RULES.createRule;
    users.updateRule = ORIGINAL_RULES.updateRule;
    users.deleteRule = ORIGINAL_RULES.deleteRule;
    users.mfa.enabled = ORIGINAL_MFA.enabled;
    users.mfa.duration = ORIGINAL_MFA.duration;
    users.mfa.rule = ORIGINAL_MFA.rule;
    users.otp.enabled = ORIGINAL_OTP.enabled;
    users.otp.duration = ORIGINAL_OTP.duration;
    users.otp.length = ORIGINAL_OTP.length;
    app.save(users);
  },
);
