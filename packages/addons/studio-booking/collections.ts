// Studio Booking collections (D144, D145, D162; invariants 1 and 3). They ship in the
// schema (migrations/) and sit empty until the add-on is on. Writes are "custom": the @cds/db
// studio module owns them and narrows a barber to their own seat. Visitors never read these
// through the generic public projection (no `public` lists): the public barber and booking
// pages read through the studio module's own allowlisted views.
//
// studio_seats.ownerField = user: a renter's generic read only ever sees their own seat.
// The other collections have no owner field, so the generic repo refuses renters (fail
// closed); the studio module is the only reader for barbers.
import type { CollectionSpec } from "@cds/core";

const FEATURE = "addon:studio-booking";

export const STUDIO_BOOKING_COLLECTIONS = {
  studio_seats: {
    kind: "base",
    feature: FEATURE,
    writes: "custom",
    restore: "replace",
    ownerField: "user",
    export: [
      "id",
      "organization",
      "user",
      "email",
      "name",
      "slug",
      "kind",
      "headline",
      "bio",
      "photo",
      "gallery",
      "hours",
      "is_published",
      "sort_order",
      "created",
      "updated",
    ],
    filterable: ["id", "slug", "is_published", "sort_order"],
  },
  studio_services: {
    kind: "base",
    feature: FEATURE,
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "seat",
      "name",
      "description",
      "duration_minutes",
      "price_cents",
      "sort_order",
      "created",
      "updated",
    ],
    filterable: ["id", "seat", "sort_order"],
  },
  // Step 2: whole days off per seat.
  studio_time_off: {
    kind: "base",
    feature: FEATURE,
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "seat",
      "start_date",
      "end_date",
      "note",
      "created",
      "updated",
    ],
    filterable: ["id", "seat", "start_date", "end_date"],
  },
  // Step 2: client bookings (client PII: never public, never generic-readable by barbers).
  studio_bookings: {
    kind: "base",
    feature: FEATURE,
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "seat",
      "reference",
      "service",
      "service_name",
      "duration_minutes",
      "price_cents",
      "starts_at",
      "ends_at",
      "client_name",
      "client_email",
      "client_phone",
      "note",
      "status",
      "reminder_sent",
      "created",
      "updated",
    ],
    filterable: ["id", "seat", "status", "starts_at"],
  },
} as const satisfies Record<string, CollectionSpec>;
