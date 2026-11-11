/// <reference path="../pb_data/types.d.ts" />
// A-WR-04 (06 review): users.pending_signup marks the pending account Submit step A creates
// (signup.ts ensurePendingUser). The code check clears it; the hourly orphan purge
// (jobs/quotes.ts) deletes only rows that still carry it, so a demoted staff member, a
// member removed from their last org or a user created by hand is never purged.
// Existing rows default to false (never purged). down removes the field.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.add(
      new BoolField({
        name: "pending_signup",
        required: false,
      }),
    );
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.fields.removeByName("pending_signup");
    app.save(users);
  },
);
