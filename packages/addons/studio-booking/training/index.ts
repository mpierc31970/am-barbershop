// Studio Booking training (D110; invariant 4). The steps live in the how-to.
import type { TrainingEntry } from "@cds/core/training";

export const TRAINING: readonly TrainingEntry[] = [
  {
    id: "addon-studio-booking",
    title: "How barber seats work",
    requirement: "D145",
    kind: "feature",
    howTo: "docs/how-to/addon-studio-booking.md",
    video: null,
  },
  {
    // A&M: barbers and the owner put the hub on their phone (seat "My page" and profile menu link here).
    id: "phone-app",
    title: "Set up the app on your phone",
    requirement: "D145",
    kind: "feature",
    howTo: "docs/how-to/addon-studio-booking-phone-app.md",
    video: null,
  },
];
