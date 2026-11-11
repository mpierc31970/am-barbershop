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
  // Hub bell + email. A new booking reaches its barber and the owner (raised with an
  // audience); members without the add-on grant never see these types.
  alerts: [
    {
      type: "studio-booking.new",
      level: "normal",
      label: "New booking",
      example: "A client booked online",
      feature: "addon:studio-booking",
      access: "read",
      section: "addon:studio-booking",
      defaultChannels: { email: true, push: true },
    },
    {
      type: "studio-booking.lease_overdue",
      level: "normal",
      label: "Chair rent late",
      example: "A chair renter's rent is past due",
      feature: "addon:studio-booking",
      access: "write",
      ownerOnly: true,
      section: "addon:studio-booking",
      defaultChannels: { email: true, push: true },
    },
  ],
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
