// Owner: 15-05 (P15-P1). Worked examples (D300) as selections, never numbers (D264, A2-Q2).
// exampleTotal() sums catalog rows: any unpriced part reads "Price coming soon"; an example that
// names an add-on outside the public view (v1.1 add-ons) or a catalog that failed to load hides.
import {
  PRICE_SOON,
  STUDIO_BOOKING_ITEM,
  catalogRow,
  formatMonthly,
  studioBookingTierKey,
  type CatalogRow,
} from "../pricing";
import type { MkPathKey } from "./paths";

export type MkExample = {
  readonly id: string;
  readonly title: string;
  readonly path: MkPathKey;
  readonly addons: readonly string[];
  /**
   * Staff count, for add-ons priced per tier (WR-B09): Studio Booking has no
   * `addon / studio-booking / studio` row, only solo / team / large-team rows (D180), so the
   * salon example resolves its row through studioBookingTierKey(staff).
   */
  readonly staff?: number;
};

export type MkExamplePart = { readonly name: string; readonly chipKey: string };

export type MkExampleTotal = {
  readonly label: string;
  readonly monthlyCents: number | null;
  readonly parts: readonly MkExamplePart[];
};

/** D300's coach and 3-stylist salon, plus a practitioner on the v1.0 add-ons. */
export const EXAMPLES: readonly MkExample[] = [
  {
    id: "coach",
    title: "A coach",
    path: "standard",
    addons: ["appointments", "newsletter"],
  },
  {
    id: "salon",
    title: "A salon with three stylists",
    path: "studio",
    addons: ["studio-booking"],
    staff: 3,
  },
  {
    id: "practitioner",
    title: "A practitioner",
    path: "standard",
    addons: ["credentials", "testimonials"],
  },
];

const PATH_NAMES: Readonly<Record<MkPathKey, string>> = {
  standard: "Standard",
  studio: "Studio",
};

/** Display names for the slugs EXAMPLES uses (registry names; v1.1 per D176-D178). */
const ADDON_NAMES: Readonly<Record<string, string>> = {
  appointments: "Appointments",
  newsletter: "Newsletter",
  "studio-booking": "Studio Booking",
  credentials: "Credentials",
  testimonials: "Testimonials",
  "builder-pro": "Builder Pro",
};

/** The catalog item key for one add-on of an example (a tier row for Studio Booking). */
export function exampleAddonKey(example: MkExample, slug: string): string {
  if (slug === STUDIO_BOOKING_ITEM && example.staff !== undefined) {
    return studioBookingTierKey(example.staff);
  }
  return slug;
}

export function exampleTotal(
  example: MkExample,
  catalog: readonly CatalogRow[] | null,
  publicSlugs: ReadonlySet<string>,
): MkExampleTotal | null {
  if (catalog === null) return null;
  if (example.addons.some((slug) => !publicSlugs.has(slug))) return null;

  const parts: MkExamplePart[] = [
    { name: PATH_NAMES[example.path], chipKey: example.path },
    ...example.addons.map((slug) => ({
      name: ADDON_NAMES[slug] ?? slug,
      chipKey: slug,
    })),
  ];

  const monthly = [
    catalogRow(catalog, "plan", "base", example.path)?.monthlyCents,
    ...example.addons.map(
      (slug) =>
        catalogRow(
          catalog,
          "addon",
          exampleAddonKey(example, slug),
          example.path,
        )?.monthlyCents,
    ),
  ];
  if (monthly.some((c) => c == null)) {
    return { label: PRICE_SOON, monthlyCents: null, parts };
  }
  const sum = (monthly as number[]).reduce((a, b) => a + b, 0);
  return { label: formatMonthly(sum), monthlyCents: sum, parts };
}
