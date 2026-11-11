// Acceptable use categories (ONB-12, D215, D218). The single source for the "Can my site be
// hosted here?" FAQ box on /start and for the FitChecker that screens a quote at Submit.
// Names and examples are copied verbatim from .planning/design/ACCEPTABLE-USE.md; a drift
// test (aup.test.ts) fails if the two disagree. This module never reads files at runtime.
// Keywords are lower-case whole-word terms; the FitChecker matches them against intake text.

export type AupVerdict = "never" | "review";

export type AupCategory = {
  name: string;
  examples: string;
  verdict: AupVerdict;
  keywords: readonly string[];
};

/** Synthetic terms so tests never depend on the real lists (RESEARCH Pitfall 10). */
export const AUP_TEST_TERMS = Object.freeze({
  blocked: "__cds_test_blocked__",
  review: "__cds_test_review__",
} as const);

export const AUP_CATEGORIES: readonly AupCategory[] = Object.freeze([
  // Never hosted
  {
    name: "Illegal content or activity",
    examples: "Anything illegal where CDS or the business operates",
    verdict: "never",
    keywords: [AUP_TEST_TERMS.blocked, "illegal", "black market"],
  },
  {
    name: "Adult sexual content and services",
    examples: "Pornography, escort services, adult live chat",
    verdict: "never",
    keywords: [
      "porn",
      "pornography",
      "escort",
      "escorts",
      "adult live chat",
      "cam girl",
      "webcam models",
    ],
  },
  {
    name: "Weapons",
    examples: "Selling firearms, ammunition, explosives or weapon parts",
    verdict: "never",
    keywords: [
      "gun shop",
      "gun store",
      "firearms dealer",
      "ammunition",
      "ammo",
      "explosives",
      "weapon parts",
      "gun parts",
    ],
  },
  {
    name: "Drugs",
    examples: "Illegal drugs, drug paraphernalia, unapproved pharmaceuticals",
    verdict: "never",
    keywords: [
      "illegal drugs",
      "paraphernalia",
      "head shop",
      "psychedelics",
      "kratom",
      "steroids",
    ],
  },
  {
    name: "Gambling",
    examples: "Online casinos, betting, lotteries",
    verdict: "never",
    keywords: [
      "casino",
      "casinos",
      "betting",
      "sportsbook",
      "lottery",
      "lotteries",
      "gambling",
      "poker",
    ],
  },
  {
    name: "Hate, harassment, violence",
    examples: "Content attacking people for who they are, threats, extremism",
    verdict: "never",
    keywords: [
      "extremism",
      "extremist",
      "hate group",
      "white power",
      "militia",
    ],
  },
  {
    name: "Fraud and deception",
    examples:
      "Scams, phishing, fake reviews, impersonation, get-rich-quick schemes, pyramid schemes",
    verdict: "never",
    keywords: [
      "scam",
      "phishing",
      "fake reviews",
      "get rich quick",
      "pyramid scheme",
      "ponzi",
    ],
  },
  {
    name: "Counterfeit and infringement",
    examples:
      "Counterfeit goods, pirated media, others' copyrighted work without permission",
    verdict: "never",
    keywords: [
      "counterfeit",
      "replica designer",
      "pirated",
      "bootleg",
      "torrent",
    ],
  },
  {
    name: "Malware and abuse",
    examples: "Malware, spam operations, hacking services",
    verdict: "never",
    keywords: [
      "malware",
      "spam service",
      "bulk spam",
      "hacking service",
      "hacker for hire",
      "ddos",
    ],
  },
  {
    name: "Personal data misuse",
    examples: "Selling personal data, doxxing",
    verdict: "never",
    keywords: ["doxxing", "doxing", "sell personal data", "data broker"],
  },
  // Allowed but reviewed first
  {
    name: "CBD / hemp, supplements, health claims",
    examples: "Legal but regulated; Stripe restricts some",
    verdict: "review",
    keywords: [
      AUP_TEST_TERMS.review,
      "cbd",
      "hemp",
      "delta-8",
      "supplements",
      "nutraceuticals",
      "weight loss",
    ],
  },
  {
    name: "Firearms training or ranges (no sales)",
    examples: "Allowed services, but must not sell weapons",
    verdict: "review",
    keywords: [
      "firearms",
      "firearm",
      "shooting range",
      "gun range",
      "concealed carry",
    ],
  },
  {
    name: "Financial advice, crypto",
    examples: "Regulated; high fraud risk",
    verdict: "review",
    keywords: [
      "crypto",
      "cryptocurrency",
      "bitcoin",
      "forex",
      "trading signals",
      "financial advice",
      "investment advice",
    ],
  },
  {
    name: "Dating, astrology, psychic and metaphysical services",
    examples:
      "Allowed; check against Stripe's restricted-business list because tenants take payments through Stripe Connect (D51)",
    verdict: "review",
    keywords: [
      "dating",
      "matchmaking",
      "astrology",
      "astrologer",
      "psychic",
      "tarot",
      "medium",
      "metaphysical",
      "spells",
    ],
  },
  {
    name: "Political or advocacy organizations",
    examples: "Allowed; checked for hate/harassment",
    verdict: "review",
    keywords: ["political", "campaign", "candidate", "advocacy", "pac"],
  },
] satisfies AupCategory[]);
