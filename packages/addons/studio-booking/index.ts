// @cds/addon-studio-booking: the manifest (D144, D145, D162, D177). Pure and client-safe.
// Hub screens are the sidebar route /hub/studio-booking (apps/web); data goes through the
// @cds/db studio module, which scopes a barber (renter/staff member holding this add-on's
// grant) to their own seat.
import { defineAddon } from "@cds/core/addons";
import { STUDIO_BOOKING_CONFIG } from "./addon.config";
import { STUDIO_BOOKING_COLLECTIONS } from "./collections";
import { INSTALL } from "./install";
import { STUDIO_SECTIONS } from "./sections";
import { TRAINING } from "./training";
import { UNINSTALL } from "./uninstall";

export default defineAddon({
  slug: STUDIO_BOOKING_CONFIG.slug,
  name: STUDIO_BOOKING_CONFIG.name,
  summary: STUDIO_BOOKING_CONFIG.summary,
  category: STUDIO_BOOKING_CONFIG.category,
  version: STUDIO_BOOKING_CONFIG.version,
  order: STUDIO_BOOKING_CONFIG.order,
  // Private: never in the Get add-ons catalog; installed for the shop by am:studio-seed.
  visibility: "private",
  paths: ["studio"],
  requires: [],
  conflicts: [],
  nav: {
    placement: "sidebar",
    label: "Barbers",
    icon: "CalendarClock",
  },
  sections: STUDIO_SECTIONS,
  collections: STUDIO_BOOKING_COLLECTIONS,
  records: {},
  install: INSTALL,
  uninstall: UNINSTALL,
  training: TRAINING,
  privacyClauses: [
    {
      id: "studio-booking",
      heading: "Barber pages and bookings",
      what: "Each barber's name, photo, bio and services. When you book: your name, email, phone and any note, with the barber, service and time you chose.",
      why: "To show who works here and to hold your appointment, confirm it and remind you before it.",
      howLong:
        "Barber pages until the barber leaves. Bookings for as long as the shop keeps its records, or until you ask us to remove them.",
    },
  ],
});
