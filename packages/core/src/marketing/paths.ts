// Owner: 15-05 (P15-P1). Standard / Studio path data for the hub (HUB-01; UI-SPEC Voice).
// Every included line carries `shipped`: true only for what the product does today (evidence
// in 15-05-SUMMARY). Unshipped lines render with ComingSoonTag. Booking (Appointments,
// Studio Booking) is v1.1 and is never an included line (D-UI-P15-25). Shop is v1.1 (D302).

export type MkPathKey = "standard" | "studio";

export type MkIncludedLine = {
  readonly text: string;
  readonly shipped: boolean;
};

export type MkPath = {
  readonly key: MkPathKey;
  readonly name: string;
  readonly whoFor: string;
  readonly included: readonly MkIncludedLine[];
  readonly startHref: string;
  readonly aboutHref: string;
  readonly crossLink: { readonly text: string; readonly href: string };
};

/** Lines every path has today (first four are the home page's 3-4 lines). */
const BASE_LINES: readonly MkIncludedLine[] = [
  {
    text: "We build your home page and one more page for you",
    shipped: true,
  },
  {
    text: "Edit every page yourself with ready-made blocks",
    shipped: true,
  },
  { text: "Hosting, backups and security updates", shipped: true },
  { text: "Help from real people within 2 business days", shipped: true },
  { text: "Up to 10 pages, with the last 10 versions of each", shipped: true },
  { text: "Your own domain, with the DNS set up for you", shipped: true },
];

export const MK_PATHS: Readonly<Record<MkPathKey, MkPath>> = {
  standard: {
    key: "standard",
    name: "Standard",
    whoFor:
      "For practitioners, coaches, stores and anyone who needs a clear site that works.",
    included: BASE_LINES,
    startHref: "/start?path=standard",
    aboutHref: "/standard",
    crossLink: { text: "Run a team? See Studio", href: "/studio" },
  },
  studio: {
    key: "studio",
    name: "Studio",
    whoFor: "For salons, spas, barbers and any business with a team.",
    included: [
      ...BASE_LINES.slice(0, 3),
      { text: "Builder Pro included: pro forms and tables", shipped: true },
      ...BASE_LINES.slice(3),
      { text: "Newsletter included", shipped: false },
      { text: "Landing pages included", shipped: false },
    ],
    startHref: "/start?path=studio",
    aboutHref: "/studio",
    crossLink: { text: "Working on your own? See Standard", href: "/standard" },
  },
};

/** The Shop coming-soon card (D300 plan, v1.1 per D302): no price, no start link. */
export const SHOP_SOON = {
  key: "shop",
  name: "Shop",
  body: "A plan built around an online store.",
  band: "Shop: coming soon. A plan built around an online store.",
  askHref: "/contact?topic=question&about=shop",
  askLabel: "Ask about Shop",
} as const;
