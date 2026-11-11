// The product paths offered at /start (ONB-11, D176, D302). Data, not code (invariant 2):
// adding the Shop path in v1.1 flips `available`, nothing else. Copy from UI-SPEC Section 1.
import type { AddonPath } from "../addons/constants";

export type PathInfo = {
  id: AddonPath;
  label: string;
  available: boolean;
  whoFor: string;
  examples: string;
};

export const PATHS: readonly PathInfo[] = Object.freeze([
  {
    id: "standard",
    label: "Standard",
    available: true,
    whoFor:
      "For practitioners, coaches, shops and services where clients don't book a staff member.",
    examples: "Therapists, consultants, tutors, bakeries, paint stores",
  },
  {
    id: "studio",
    label: "Studio",
    available: true,
    whoFor:
      "For businesses where clients book a service with a member of your team.",
    examples: "Salons, spas, barbers, nails, lashes, massage, tattoo",
  },
  {
    // D302: the Shop plan ships in v1.1.
    id: "shop",
    label: "Shop",
    available: false,
    whoFor: "Selling products online first?",
    examples: "Online stores",
  },
]);

/**
 * Per-path offer rules. seeAllOnly slugs are never recommended on that path, only listed
 * under "See all add-ons": Events is allowed on Studio but never pushed there (D268, D177).
 */
export const PATH_RULES: Readonly<
  Partial<Record<AddonPath, { seeAllOnly: readonly string[] }>>
> = Object.freeze({
  studio: { seeAllOnly: ["events"] },
});
