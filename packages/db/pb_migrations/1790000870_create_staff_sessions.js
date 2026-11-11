/// <reference path="../pb_data/types.d.ts" />
// STAFF-06 (P13-P1, P13-P6): staff console sessions. A platform collection: one row per
// signed-in staff session, keyed by token_hash (sha256 hex of the PocketBase token). The token
// itself is never stored. last_seen_at drives the 2 h idle timeout, created the 12 h absolute
// one, step_up_at the 15-minute step-up window, ended_at the server-side sign-out. user is the
// staff record id (text, never a relation into the staff auth collection). token_hash and ip
// are serverOnly in BROWSER_FIELDS. All API rules null (invariant 1).
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "staff_sessions",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: "text", name: "token_hash", required: true, max: 64 },
        { type: "text", name: "user", required: true, max: 15 },
        { type: "date", name: "last_seen_at" },
        { type: "date", name: "step_up_at" },
        { type: "date", name: "ended_at" },
        { type: "text", name: "ip", max: 64 },
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_staff_sessions_token_hash ON staff_sessions (token_hash)",
        "CREATE INDEX idx_staff_sessions_user ON staff_sessions (user)",
      ],
    });
    app.save(collection);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("staff_sessions"));
  },
);
