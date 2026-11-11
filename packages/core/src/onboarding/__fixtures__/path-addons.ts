// TEST ONLY: fixture add-ons that prove the path rules (ONB-11, D176, D177, D268). Never
// imported by production code and never registered by the app.
import { composeAddonRegistry } from "../../addons/compose";
import {
  FIXTURE_PRIVATE,
  FIXTURE_QUOTE,
  fixtureManifest,
} from "../../addons/__fixtures__/manifests";
import type { AddonRegistry } from "../../addons/types";

export const FIXTURE_APPOINTMENTS = fixtureManifest({
  slug: "fixture-appointments",
  name: "Appointments",
  order: 100,
  paths: ["standard"],
});

export const FIXTURE_STUDIO_BOOKING = fixtureManifest({
  slug: "fixture-studio-booking",
  name: "Studio Booking",
  order: 110,
  paths: ["studio"],
});

export const FIXTURE_EVENTS = fixtureManifest({
  slug: "fixture-events",
  name: "Events",
  order: 120,
  paths: ["standard", "studio"],
});

/** FIXTURE_QUOTE stands in for a testimonials-like add-on (standard only, public). */
export function pathFixtureRegistry(): AddonRegistry {
  return composeAddonRegistry(
    [
      FIXTURE_EVENTS,
      FIXTURE_QUOTE,
      FIXTURE_APPOINTMENTS,
      FIXTURE_PRIVATE,
      FIXTURE_STUDIO_BOOKING,
    ],
    { fileExists: () => true },
  );
}
