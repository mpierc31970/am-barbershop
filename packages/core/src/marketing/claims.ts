// Owner: 15-04 (P15-P1). Verified competitor claims (CLAIMS) with sources and dates.
// HUB-06, D182, D296. Every competitor figure the hub shows lives here, with its source and the date it was
// last read. Seeded as "draft" from .planning/research/BOOKING-COMPETITORS.md (2026-09-24) and 15-RESEARCH
// (Stripe and Fresha re-read 2026-10-17). Production renders verified claims only (visibleClaims, P15-P4);
// the user re-checks each source and flips status + verifiedOn (15-29). Health check 51 alarms when the
// oldest verified claim is over 150 / 183 days old.

export type ClaimStatus = "draft" | "verified";

/** Which comparison row a claim supports (UI-SPEC "Comparison"). */
export type ClaimRow =
  "processing" | "marketplace" | "stack" | "contracts" | "gateway";

/** A card rate: 3.6% + 30 cents is { pct: 3.6, fixedCents: 30 }. */
export type ClaimRate = { pct: number; fixedCents: number };

/** A share of a first visit, with optional per-client floor and cap in cents. */
export type ClaimShare = { pct: number; minCents?: number; maxCents?: number };

export type Claim = {
  id: string;
  text: string;
  competitor: string;
  figure: string;
  sourceUrl: string;
  sourceTitle: string;
  /** YYYY-MM-DD, the day the figure was last read at the source. */
  verifiedOn: string;
  status: ClaimStatus;
  row: ClaimRow;
  rate?: ClaimRate;
  share?: ClaimShare;
  monthlyCents?: number;
};

export const CLAIM_ROWS: readonly ClaimRow[] = [
  "processing",
  "marketplace",
  "stack",
  "contracts",
  "gateway",
] as const;

export const CLAIMS: readonly Claim[] = [
  {
    id: "processing-range",
    text: "Most run your card payments themselves and charge 2.3% to 3.6% a sale.",
    competitor: "Vagaro, Mindbody",
    figure: "About 2.29% (Vagaro) to 3.60% + 30¢ (Mindbody online)",
    sourceUrl: "https://www.vagaro.com/pro/card-processing",
    sourceTitle: "Vagaro card processing",
    verifiedOn: "2026-09-24",
    status: "draft",
    row: "processing",
  },
  {
    id: "mindbody-online",
    text: "Mindbody charges 3.60% + 30¢ on online card payments.",
    competitor: "Mindbody",
    figure: "3.60% + 30¢ online",
    sourceUrl: "https://www.mindbodyonline.com/business/pricing",
    sourceTitle: "Mindbody pricing",
    verifiedOn: "2026-09-24",
    status: "draft",
    row: "processing",
    rate: { pct: 3.6, fixedCents: 30 },
  },
  {
    id: "boulevard-online",
    text: "Boulevard charges 3.65% + 15¢ on online card payments.",
    competitor: "Boulevard",
    figure: "3.65% + 15¢ online",
    sourceUrl: "https://www.joinblvd.com/pricing",
    sourceTitle: "Boulevard pricing",
    verifiedOn: "2026-09-24",
    status: "draft",
    row: "processing",
    rate: { pct: 3.65, fixedCents: 15 },
  },
  {
    id: "fresha-marketplace",
    text: "Fresha takes 20% of a new client's first visit when they find you through its app, at least $6.",
    competitor: "Fresha",
    figure: "20% one-time commission, minimum fee of $6 per client",
    sourceUrl: "https://www.fresha.com/pricing",
    sourceTitle: "Fresha pricing",
    verifiedOn: "2026-10-17",
    status: "draft",
    row: "marketplace",
    share: { pct: 20, minCents: 600 },
  },
  {
    id: "booksy-boost",
    text: "Booksy Boost takes 30% of a new client's first visit, from $10 to $100.",
    competitor: "Booksy",
    figure: "30% of the first visit ($10 to $100)",
    sourceUrl:
      "https://support.booksy.com/hc/en-us/articles/16486248108946-How-does-Boost-pricing-work",
    sourceTitle: "Booksy: How does Boost pricing work?",
    verifiedOn: "2026-09-24",
    status: "draft",
    row: "marketplace",
    share: { pct: 30, minCents: 1000, maxCents: 10000 },
  },
  {
    id: "vagaro-stack",
    text: "Common extras like a website, forms and text marketing are often billed one by one.",
    competitor: "Vagaro",
    figure: "Website $20, forms $10 and text marketing $20 a month",
    sourceUrl: "https://www.vagaro.com/pro/pricing",
    sourceTitle: "Vagaro pricing",
    verifiedOn: "2026-09-24",
    status: "draft",
    row: "stack",
    monthlyCents: 5000,
  },
  {
    id: "mindbody-contract",
    text: "Mindbody typically asks for a 24-month contract.",
    competitor: "Mindbody",
    figure: "Typically 24 months",
    sourceUrl: "https://www.fitbudd.com/post/how-much-does-mindbody-cost",
    sourceTitle: "FitBudd: How much does Mindbody cost?",
    verifiedOn: "2026-09-24",
    status: "draft",
    row: "contracts",
  },
  {
    id: "boulevard-contract",
    text: "Boulevard usually asks for a 12-month contract.",
    competitor: "Boulevard",
    figure: "Usually 12 months",
    sourceUrl: "https://thesalonbusiness.com/boulevard-software-review/",
    sourceTitle: "The Salon Business: Boulevard software review",
    verifiedOn: "2026-09-24",
    status: "draft",
    row: "contracts",
  },
  {
    id: "stripe-online",
    text: "Stripe charges 2.9% + 30¢ per successful online card payment in the US.",
    competitor: "Stripe",
    figure: "2.9% + 30¢ per successful transaction for domestic cards",
    sourceUrl: "https://stripe.com/pricing",
    sourceTitle: "Stripe pricing",
    verifiedOn: "2026-10-17",
    status: "draft",
    row: "gateway",
    rate: { pct: 2.9, fixedCents: 30 },
  },
];

/** The claim with this id; throws so a renamed claim fails loudly instead of rendering nothing. */
export function claimById(id: string, all: readonly Claim[] = CLAIMS): Claim {
  const c = all.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown claim id: ${id}`);
  return c;
}

/** Production shows verified claims only; dev shows every claim (drafts get a DRAFT badge). */
export function visibleClaims(
  all: readonly Claim[],
  production: boolean,
): Claim[] {
  return production ? all.filter((c) => c.status === "verified") : [...all];
}

/** Whole days since the oldest verified claim was checked; null when none is verified. */
export function oldestVerifiedDays(
  all: readonly Claim[],
  now: Date,
): number | null {
  const v = all
    .filter((c) => c.status === "verified")
    .map((c) => Date.parse(`${c.verifiedOn}T00:00:00Z`));
  return v.length
    ? Math.floor((now.getTime() - Math.min(...v)) / 86_400_000)
    : null;
}

const CHECKED_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** "2026-09-24" -> "September 24, 2026" (UTC, so the footnote never shifts by a day). */
export function formatCheckedDate(iso: string): string {
  return CHECKED_FMT.format(new Date(`${iso}T00:00:00Z`));
}
