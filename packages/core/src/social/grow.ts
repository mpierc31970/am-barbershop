// "Grow your social" checklist content (11-07; DASH-16, D200). Static, free, plain words
// (D119). Pure and browser-safe.
//
// Tips are keyed by platform (a preset key, or "all" for Every account) and by business
// category. Categories are the intake business-type copy groups (`CopyGroup` from
// onboarding/business-types): practice, shop, service, studio, community, other.
// `growCategoryFor(businessTypeId)` maps an intake business type to its group.
import { findBusinessType, type CopyGroup } from "../onboarding/business-types";
import { isPresetKey } from "./presets";

export type GrowCategory = CopyGroup;

export type GrowTip = {
  readonly id: string;
  /** A preset key, or "all" for tips that apply to every account. */
  readonly platform: string;
  readonly categories: readonly GrowCategory[] | "all";
  readonly text: string;
};

const tip = (t: GrowTip): GrowTip =>
  Object.freeze({
    ...t,
    categories:
      t.categories === "all" ? "all" : Object.freeze([...t.categories]),
  });

const VISIT = ["shop", "community"] as const satisfies readonly GrowCategory[];
const BOOK = [
  "practice",
  "service",
  "studio",
] as const satisfies readonly GrowCategory[];

export const GROW_CHECKLIST: readonly GrowTip[] = Object.freeze([
  // Every account
  tip({
    id: "all-same-name",
    platform: "all",
    categories: "all",
    text: "Use the same business name and profile photo on every account",
  }),
  tip({
    id: "all-bio-link",
    platform: "all",
    categories: "all",
    text: "Put your bio link from this page in every account's bio",
  }),
  tip({
    id: "all-hours",
    platform: "all",
    categories: "all",
    text: "Keep your hours and phone number the same everywhere",
  }),
  tip({
    id: "all-reply",
    platform: "all",
    categories: "all",
    text: "Reply to comments and messages within a day",
  }),
  tip({
    id: "all-book-cta",
    platform: "all",
    categories: BOOK,
    text: 'End some posts with how to book: "Book from the link in our bio"',
  }),
  tip({
    id: "all-visit-cta",
    platform: "all",
    categories: VISIT,
    text: "End some posts with how to find you: your street or the link in your bio",
  }),

  // Facebook
  tip({
    id: "fb-bio-link",
    platform: "facebook",
    categories: "all",
    text: "Put your bio link from this page in your Facebook page's Website field",
  }),
  tip({
    id: "fb-category",
    platform: "facebook",
    categories: "all",
    text: "Set your Facebook page category and service area",
  }),
  tip({
    id: "fb-reviews",
    platform: "facebook",
    categories: "all",
    text: "Turn on Facebook reviews and thank people who leave one",
  }),
  tip({
    id: "fb-events",
    platform: "facebook",
    categories: ["community", "shop"],
    text: "Post your events on Facebook so people can say they're going",
  }),
  tip({
    id: "fb-before-after",
    platform: "facebook",
    categories: ["studio", "service"],
    text: "Share a before-and-after photo once a month, with the client's OK",
  }),

  // Instagram
  tip({
    id: "ig-bio-link",
    platform: "instagram",
    categories: "all",
    text: "Put your bio link from this page in your Instagram bio",
  }),
  tip({
    id: "ig-highlights",
    platform: "instagram",
    categories: "all",
    text: "Save your best stories as Highlights: prices, reviews, how to find you",
  }),
  tip({
    id: "ig-portfolio",
    platform: "instagram",
    categories: ["studio", "service"],
    text: "Post your recent work at least once a week",
  }),
  tip({
    id: "ig-products",
    platform: "instagram",
    categories: ["shop"],
    text: "Post one product photo a week with its price in the caption",
  }),
  tip({
    id: "ig-faces",
    platform: "instagram",
    categories: ["practice", "community", "other"],
    text: "Post a photo of you or your team so people know who they'll meet",
  }),

  // TikTok
  tip({
    id: "tt-bio-link",
    platform: "tiktok",
    categories: "all",
    text: "Put your bio link from this page in your TikTok bio",
  }),
  tip({
    id: "tt-short",
    platform: "tiktok",
    categories: "all",
    text: "Keep videos short: show one thing in under 30 seconds",
  }),
  tip({
    id: "tt-behind",
    platform: "tiktok",
    categories: "all",
    text: "Film a behind-the-scenes clip of a normal day",
  }),
  tip({
    id: "tt-how-to",
    platform: "tiktok",
    categories: ["studio", "service", "practice"],
    text: "Answer a question clients often ask, in one short video",
  }),

  // YouTube
  tip({
    id: "yt-bio-link",
    platform: "youtube",
    categories: "all",
    text: "Put your bio link from this page in your YouTube channel's links",
  }),
  tip({
    id: "yt-intro",
    platform: "youtube",
    categories: "all",
    text: "Make a one-minute video that says who you are and what you do",
  }),
  tip({
    id: "yt-titles",
    platform: "youtube",
    categories: "all",
    text: 'Name videos the way people search: "How to…" or "What to expect at…"',
  }),
  tip({
    id: "yt-faq",
    platform: "youtube",
    categories: ["practice", "service"],
    text: "Turn your three most common questions into three short videos",
  }),

  // LinkedIn
  tip({
    id: "li-bio-link",
    platform: "linkedin",
    categories: "all",
    text: "Put your bio link from this page in your LinkedIn contact info",
  }),
  tip({
    id: "li-headline",
    platform: "linkedin",
    categories: "all",
    text: "Write a headline that says who you help and how",
  }),
  tip({
    id: "li-credentials",
    platform: "linkedin",
    categories: ["practice", "service"],
    text: "List your licenses and certifications on your profile",
  }),
  tip({
    id: "li-share-wins",
    platform: "linkedin",
    categories: "all",
    text: "Share one work story or lesson a month",
  }),

  // Pinterest
  tip({
    id: "pin-bio-link",
    platform: "pinterest",
    categories: "all",
    text: "Put your bio link from this page in your Pinterest profile",
  }),
  tip({
    id: "pin-boards",
    platform: "pinterest",
    categories: "all",
    text: 'Make boards named the way people search, like "Spring nail ideas"',
  }),
  tip({
    id: "pin-link-pins",
    platform: "pinterest",
    categories: "all",
    text: "Link each pin to the matching page on your site",
  }),
  tip({
    id: "pin-products",
    platform: "pinterest",
    categories: ["shop"],
    text: "Pin your products with their prices",
  }),

  // X
  tip({
    id: "x-bio-link",
    platform: "x",
    categories: "all",
    text: "Put your bio link from this page in your X profile",
  }),
  tip({
    id: "x-pin-post",
    platform: "x",
    categories: "all",
    text: "Pin a post that says what you do and how to reach you",
  }),
  tip({
    id: "x-local",
    platform: "x",
    categories: "all",
    text: "Join local conversations: reply to neighbors and nearby businesses",
  }),
  tip({
    id: "x-updates",
    platform: "x",
    categories: ["shop", "community"],
    text: "Post quick updates: new stock, changed hours, today's special",
  }),

  // Threads
  tip({
    id: "th-bio-link",
    platform: "threads",
    categories: "all",
    text: "Put your bio link from this page in your Threads bio",
  }),
  tip({
    id: "th-from-ig",
    platform: "threads",
    categories: "all",
    text: "Share your Instagram posts to Threads too",
  }),
  tip({
    id: "th-questions",
    platform: "threads",
    categories: "all",
    text: "Ask a simple question once a week and answer every reply",
  }),
  tip({
    id: "th-tips",
    platform: "threads",
    categories: ["practice", "service", "studio"],
    text: "Post one quick tip from your work each week",
  }),

  // Yelp
  tip({
    id: "yelp-bio-link",
    platform: "yelp",
    categories: "all",
    text: "Put your bio link from this page in your Yelp business page's website field",
  }),
  tip({
    id: "yelp-claim",
    platform: "yelp",
    categories: "all",
    text: "Claim your Yelp business page and check your hours",
  }),
  tip({
    id: "yelp-photos",
    platform: "yelp",
    categories: "all",
    text: "Add at least five photos of your space and work",
  }),
  tip({
    id: "yelp-respond",
    platform: "yelp",
    categories: "all",
    text: "Answer every review, kindly, even the hard ones",
  }),

  // Nextdoor
  tip({
    id: "nd-bio-link",
    platform: "nextdoor",
    categories: "all",
    text: "Put your bio link from this page in your Nextdoor business page",
  }),
  tip({
    id: "nd-claim",
    platform: "nextdoor",
    categories: "all",
    text: "Claim your Nextdoor business page so neighbors can recommend you",
  }),
  tip({
    id: "nd-ask-recs",
    platform: "nextdoor",
    categories: "all",
    text: "Ask happy local clients to recommend you on Nextdoor",
  }),
  tip({
    id: "nd-local-offer",
    platform: "nextdoor",
    categories: ["shop", "service", "studio"],
    text: "Post a neighbors-only offer once a season",
  }),
]);

/** Maps an intake business type id to its Grow category; unknown types are "other". */
export function growCategoryFor(businessTypeId: unknown): GrowCategory {
  return findBusinessType(businessTypeId)?.copyGroup ?? "other";
}

/**
 * Tips for a site: Every account tips plus tips for each connected preset platform, filtered
 * to the business category ("all"-category tips always included), in checklist order.
 */
export function growTipsFor(
  platforms: readonly string[],
  category: string,
): GrowTip[] {
  const wanted = new Set<string>([
    "all",
    ...platforms.filter((p) => isPresetKey(p)),
  ]);
  return GROW_CHECKLIST.filter(
    (t) =>
      wanted.has(t.platform) &&
      (t.categories === "all" ||
        (t.categories as readonly string[]).includes(category)),
  );
}
