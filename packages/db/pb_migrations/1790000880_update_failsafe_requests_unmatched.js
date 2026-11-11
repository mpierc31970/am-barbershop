/// <reference path="../pb_data/types.d.ts" />
// 13 review fix (CR-A01, WR-A01; STAFF-14, D155, D156): a captured booking request is never
// skipped. failsafe_requests can now hold a request that matched no site:
// - `organization` is optional; an org-less row is staff-only (every tenant read filters on
//   organization, so it never reaches a site).
// - `status` gains `unmatched`; `org_slug` keeps the slug the capture named and `reason`
//   says why (no_site, addon_inactive, store_failed). The sync re-matches these rows each run.
// - `email` becomes plain text (max 254): the capture form's check is looser than
//   PocketBase's email field, and one rejected row stalled the pull cursor for good.
// - a unique index on `capture_id` alone (capture ids are random and global).
// Down deletes the org-less rows first (the fail-safe service still holds them unacked),
// maps the email column back and restores the 13-06 values. All API rules stay null
// (invariant 1).
const P13_STATUS = ["pending", "converted", "dismissed"];

migrate(
  (app) => {
    let col = app.findCollectionByNameOrId("failsafe_requests");
    col.fields.add(new TextField({ name: "email_text", max: 254 }));
    app.save(col);
    app
      .db()
      .newQuery("UPDATE failsafe_requests SET email_text = COALESCE(email, '')")
      .execute();
    col = app.findCollectionByNameOrId("failsafe_requests");
    col.fields.removeByName("email");
    app.save(col);
    col = app.findCollectionByNameOrId("failsafe_requests");
    col.fields.getByName("email_text").name = "email";
    col.fields.getByName("organization").required = false;
    col.fields.getByName("status").values = P13_STATUS.concat(["unmatched"]);
    col.fields.add(new TextField({ name: "org_slug", max: 63 }));
    col.fields.add(new TextField({ name: "reason", max: 40 }));
    col.indexes = col.indexes.concat([
      "CREATE UNIQUE INDEX idx_failsafe_requests_capture ON failsafe_requests (capture_id)",
    ]);
    app.save(col);
  },
  (app) => {
    for (const rec of app.findAllRecords("failsafe_requests")) {
      if (
        rec.getString("organization") === "" ||
        rec.getString("status") === "unmatched"
      ) {
        app.delete(rec);
      }
    }
    let col = app.findCollectionByNameOrId("failsafe_requests");
    col.indexes = col.indexes.filter(
      (i) => !i.includes("idx_failsafe_requests_capture "),
    );
    col.fields.removeByName("org_slug");
    col.fields.removeByName("reason");
    col.fields.getByName("status").values = P13_STATUS;
    col.fields.getByName("organization").required = true;
    col.fields.getByName("email").name = "email_text";
    app.save(col);
    col = app.findCollectionByNameOrId("failsafe_requests");
    col.fields.add(new EmailField({ name: "email" }));
    app.save(col);
    app
      .db()
      .newQuery(
        "UPDATE failsafe_requests SET email = email_text WHERE email_text LIKE '%_@_%'",
      )
      .execute();
    col = app.findCollectionByNameOrId("failsafe_requests");
    col.fields.removeByName("email_text");
    app.save(col);
  },
);
