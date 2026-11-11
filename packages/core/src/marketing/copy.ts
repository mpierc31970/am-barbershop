// Owner: 15-05 (P15-P1). Every visible marketing string (UI-SPEC verbatim; HUB-01, HUB-05).
// Pages and @cds/ui/marketing components read these; no marketing copy is hard-coded in JSX.
// Never a price here: prices come from the catalog through @cds/core/pricing (D264). The only
// `$`+digit strings are the calculator input bounds CALC_ERR_SALES / CALC_ERR_AVG
// (tests/marketing-boundary.test.ts allow-lists those two keys only).

/** D296 positioning line (UI-SPEC Voice, verbatim). */
export const MK_PITCH = "No platform cut on your own gateway.";

/** Comparison H2 (UI-SPEC Voice, verbatim). */
export const MK_COMPARISON_HEADING =
  "How they make their money, and how we don't";

/** D296: never imply processing is free (UI-SPEC Voice, verbatim). */
export const MK_GATEWAY_SENTENCE =
  "You still pay your own payment processor's fees, e.g. Stripe 2.9% + 30¢ online. That money goes to Stripe, not to us.";

export const HELLO_EMAIL = "hello@connectionsdesignstudios.com";
export const ABUSE_EMAIL = "abuse@connectionsdesignstudios.com";

/** D249 report line (UI-SPEC Voice, verbatim). */
export const MK_ABUSE_LINE = "or email abuse@connectionsdesignstudios.com";

/** D299: support is in every plan. */
export const SUPPORT_LINE =
  "We answer how-to questions within 2 business days and fix anything we built.";

/** D168 terms only (D167 amount): no other figure. */
export const INDEPENDENT_PRO_OFFER =
  "If you've worked inside a business that runs on CDS and you're starting your own, you get 25% off your build fee and your first month free.";

/** Stripe promotion code for the D168 offer; null until the GO-LIVE row sets it. */
export const INDEPENDENT_PRO_CODE: string | null = null;

const START = "Start your site";
const CLOSING_FULL_PRICE = "See your full price before you commit.";

const GOOD_TO_KNOW = [
  {
    term: "Month to month",
    detail: "Cancel any month. Pay a year upfront and get 2 months free.",
  },
  { term: "Support is included", detail: SUPPORT_LINE },
  {
    term: "Care Plan is optional",
    detail: "Want us to make changes for you? Add the Care Plan.",
    href: "/pricing#care-plan",
  },
  { term: "Your gateway, your money", detail: MK_GATEWAY_SENTENCE },
] as const;

export const MK_COPY = {
  HEADER: {
    NAV: [
      { label: "Standard", href: "/standard" },
      { label: "Studio", href: "/studio" },
      { label: "Add-ons", href: "/add-ons" },
      { label: "Pricing", href: "/pricing" },
      { label: "Work", href: "/work" },
    ],
    MENU_EXTRA: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ],
    SIGN_IN: "Sign in",
    START,
    START_SHORT: "Start",
    MENU: "Menu",
    CLOSE_MENU: "Close menu",
    SKIP: "Skip to content",
    NAV_LABEL: "Main",
  },
  FOOTER: {
    NAV_LABEL: "Footer",
    PITCH: MK_PITCH,
    COLUMNS: [
      {
        title: "Platform",
        links: [
          { label: "Standard", href: "/standard" },
          { label: "Studio", href: "/studio" },
          { label: "Add-ons", href: "/add-ons" },
          { label: "Pricing", href: "/pricing" },
        ],
      },
      {
        title: "CDS",
        links: [
          { label: "Work", href: "/work" },
          { label: "About", href: "/about" },
          { label: "Contact", href: "/contact" },
          { label: "Independent pros", href: "/independent-pros" },
        ],
      },
      {
        title: "Rules",
        links: [
          { label: "Hosting rules", href: "/hosting-rules" },
          { label: "Report", href: "/report" },
          { label: "Privacy", href: "/privacy" },
          { label: "Terms", href: "/legal/terms-of-service" },
        ],
      },
    ],
    SIGN_IN: "Sign in",
  },
  HOME: {
    H1: "We build your website. Then we keep it running.",
    LEAD: "Pick a path and the parts you need. Pay one build fee, then one monthly price, month to month. Support is in every plan.",
    PITCH: MK_PITCH,
    START,
    SEE_PRICING: "See pricing",
    SEE_DEMO: "See a live demo",
    SEE_ALL_ADDONS: "See all add-ons",
    DECK_LABEL: "Paths and add-ons",
    PATHS_H2: "Two ways to start",
    SHOP_BAND: "Shop: coming soon. A plan built around an online store.",
    ASK_SHOP: "Ask about Shop",
    EXAMPLES_H2: "What it costs, worked out",
    SEE_ALL_PRICES: "See all prices",
    HOW_H2: "How it works",
    STEPS: [
      {
        title: "Choose",
        body: "Pick your path and add-ons. Your price updates as you go.",
      },
      {
        title: "Sign and pay",
        body: "Read the agreement, sign it, and pay the build fee.",
      },
      {
        title: "We build it",
        body: "We build your first pages and set everything up. We check every site before it goes live.",
      },
      {
        title: "You take it from there",
        body: "Edit your pages yourself, any time. Ask us when you need help.",
      },
    ],
    DEMO_H2: "See a real site in action",
    DEMO_BODY:
      "Bella's Salon is a demo site on the Studio path. Look around. It resets every night.",
    OPEN_DEMO: "Open the demo",
    PROOF_H2: "Sites we've built",
    SEE_WORK: "See our work",
    MONEY_LINE: MK_PITCH,
    MONEY_BODY:
      "We keep your monthly price. Your customers' payments go to your own gateway.",
    MONEY_LINK: "See how other platforms charge",
    CLOSING_H2: CLOSING_FULL_PRICE,
  },
  PATHS: {
    INCLUDED_H2: {
      standard: "What's in every Standard site",
      studio: "What's in every Studio site",
    },
    ADDONS_H2: {
      standard: "Add-ons on Standard",
      studio: "Add-ons on Studio",
    },
    START: {
      standard: "Start on Standard",
      studio: "Start on Studio",
    },
    ABOUT: {
      standard: "About Standard",
      studio: "About Studio",
    },
    SEE_DEMO: "See a live demo",
    GOOD_TO_KNOW,
    CLOSING_H2: {
      standard: "Ready to start on Standard?",
      studio: "Ready to start on Studio?",
    },
  },
  ADDONS: {
    H1: "Add-ons",
    LEAD: "Switch on the parts your business needs. Add them when you start, or later from your dashboard.",
    FILTER: [
      { label: "All", path: null },
      { label: "Standard", path: "standard" },
      { label: "Studio", path: "studio" },
    ],
    ADD: "Add to my site",
    ASK: "Ask about it",
    NOT_ON_PATH: "Not on this path",
    INCLUDED: "Included",
    EMPTY_H2: "Add-ons are on their way.",
    EMPTY_BODY:
      "Start with a path now. You can add parts later from your dashboard.",
    CLOSING_H2: "Not sure what you need?",
    ASK_QUESTION: "Ask a question",
    START,
    BREADCRUMB: "Add-ons",
    MORE: "See all add-ons",
    WORKS_ON_BOTH: "Works on Standard and Studio",
    WORKS_ON_STANDARD: "Standard only",
    WORKS_ON_STUDIO: "Studio only",
  },
  PRICING: {
    H1: "Pricing",
    LEAD: "One build fee to make your site. One monthly price to run it. Month to month, and support is in every plan.",
    PITCH: MK_PITCH,
    PLANS_LABEL: "Plans",
    BUILD_FEE_SUFFIX: "one-time build",
    YEARLY: "Or pay yearly and get 2 months free",
    SHOP_TITLE: "Shop",
    SHOP_BODY: "A plan built around an online store.",
    ASK_SHOP: "Ask about Shop",
    TABLE_CAPTION: "Add-on prices by path",
    TABLE_COLUMNS: ["Add-on", "Standard", "Studio"],
    INCLUDED: "Included",
    NOT_ON_PATH: "Not on this path",
    CARE_H2: "Care Plan (optional)",
    CARE_BODY:
      "Support is already in every plan. The Care Plan is for when you'd rather we make the changes for you.",
    CARE_LINK: "Add it when you start",
    EXAMPLES_H2: "What it costs, worked out",
    GOOD_TO_KNOW_H2: "Good to know",
    GOOD_TO_KNOW: [
      ...GOOD_TO_KNOW,
      {
        term: "If you leave",
        detail: "You can download all your data and take your domain with you.",
      },
    ],
    CLOSING_H2: CLOSING_FULL_PRICE,
    START,
  },
  COMPARISON: {
    H2: MK_COMPARISON_HEADING,
    INTRO:
      "Many booking and website platforms are free to set up. They make their money from your sales instead. Here is how, and what we do instead.",
    CAPTION: "How other platforms charge compared with CDS",
    COL_ELSEWHERE: "How they make it",
    COL_CDS: "How we make ours",
    ROWS: {
      processing: {
        header: "Card processing",
        cds: "We never touch your payments. You use your own gateway, like Stripe, and pay its fees directly.",
      },
      marketplace: {
        header: "Marketplace fees",
        cds: "No commission. Every client is your client.",
      },
      stack: {
        header: "Add-ons that stack",
        cds: "Each add-on has one listed price. You see the total before you pay.",
      },
      contracts: {
        header: "Contracts",
        cds: "Month to month. Pay a year up front only if you want 2 months free.",
      },
    },
    GATEWAY: MK_GATEWAY_SENTENCE,
    DRAFT_NOTE: "DRAFT claims: check every source before launch.",
    DRAFT: "DRAFT",
    BACK_TO_TEXT: "Back to text",
    FOOTNOTES_LABEL: "Sources for these figures",
  },
  SOURCES: {
    H2: "Sources",
    CAPTION: "Where every figure on this page comes from",
    COLUMNS: ["Competitor", "Figure", "Source", "Checked"],
  },
  CALC: {
    H2: "What would you keep?",
    LEAD: "Put in your own numbers. Nothing is saved or sent.",
    SALES_LABEL: "Card sales a month",
    SALES_HELP: "Everything your customers pay by card in a month.",
    AVG_LABEL: "Average sale",
    AVG_HELP: "A typical visit or order.",
    COUNT_LABEL: "New clients a month from a booking app",
    COUNT_HELP:
      "Only if clients would find you through an app like Fresha or Booksy.",
    PATH_LABEL: "Your CDS path",
    ELSEWHERE: "Elsewhere",
    WITH_CDS: "With CDS",
    PROCESSING: "Card processing",
    MARKETPLACE: "Marketplace fees",
    STACK: "Add-ons many owners need",
    // WR-B08 (D182 accuracy): both totals are what the owner pays a month. The old "what the
    // platform keeps" counted the whole card rate elsewhere (mostly interchange, the same cost
    // the CDS side pays Stripe) against the CDS plan alone.
    KEEPS: "What you pay a month",
    PLATFORM_CUT: "Platform cut",
    PLAN: "Your CDS plan (before add-ons)",
    GATEWAY: MK_GATEWAY_SENTENCE,
  },
  WORK: {
    H1: "Our work",
    LEAD: "Real sites for real businesses, and a demo you can click through.",
    SITES_H2: "Sites we've built",
    VISIT: "Visit site",
    SAY_H2: "What clients say",
    EMPTY:
      "We're adding client sites here soon. In the meantime, try the demo.",
    CLOSING_H2: "Want one like these?",
    START,
  },
  ABOUT: {
    H1: "About CDS",
    LEAD: "Connections Design Studios builds and runs websites for small businesses. You get a site made for you, and people who look after it.",
    HOW: [
      {
        title: "Built by people",
        body: "We build your first pages and check every site before launch.",
      },
      {
        title: "A curated set of parts",
        body: "Pick add-ons instead of a blank canvas. Your site always stays on your brand.",
      },
      {
        title: "Help is in the plan",
        body: "Support is in every plan. Add the Care Plan if you want us to do the changes.",
      },
    ],
    WHO_H2: "Who we work with",
    WHO_BODY:
      "Salons, spas, barbers, practitioners, coaches, small shops and community groups.",
    CLOSING_H2: "Questions first?",
    CONTACT: "Contact us",
    START,
  },
  CONTACT: {
    H1: "Contact us",
    LEAD: "Ask a question or ask for a call. We reply by email.",
    EMAIL: HELLO_EMAIL,
    ASIDE_REPORT_BEFORE: "To report content on a site we host, use the",
    ASIDE_REPORT_LINK: "Report page",
    ASIDE_SIGN_IN_BEFORE: "Already a customer?",
    ASIDE_SIGN_IN_LINK: "Sign in",
    ASIDE_SIGN_IN_AFTER: "and use CDS Support.",
    NAME: "Name",
    EMAIL_LABEL: "Email",
    BUSINESS: "Business name (optional)",
    TOPIC: "What's this about?",
    TOPICS: [
      { value: "question", label: "A question" },
      { value: "call", label: "I'd like a call" },
      { value: "press", label: "Press or partnership" },
    ],
    PHONE: "Phone",
    PHONE_NOSCRIPT: "Phone (only if you'd like a call)",
    MESSAGE: "Message",
    SEND: "Send message",
    SENDING: "Sending…",
    ERROR_SUMMARY: "Check these and send again:",
    ERR_NAME: "Enter your name.",
    ERR_EMAIL: "Enter an email like name@example.com.",
    ERR_MESSAGE_SHORT: "Write at least 10 characters.",
    ERR_MESSAGE_LONG: "Keep it under 2,000 characters.",
    ERR_TOPIC: "Choose what this is about.",
    ERR_TURNSTILE: "We couldn't check you're not a bot. Try again.",
    ERR_RATE:
      "Too many messages from this connection. Try again in an hour, or email hello@connectionsdesignstudios.com.",
    ERR_SERVER:
      "Your message didn't send. Try again, or email hello@connectionsdesignstudios.com.",
    SENT_H2: "Thanks, we've got it.",
    BACK_HOME: "Back to home",
  },
  INDIE: {
    H1: "Going out on your own?",
    LEAD: INDEPENDENT_PRO_OFFER,
    STEPS: [
      "Start your site like anyone else.",
      "Tell us where you worked.",
      "We apply the offer before you pay.",
    ],
    NEUTRAL:
      "The offer is the same for everyone. Your old workplace doesn't decide it, and we never contact anyone about it.",
    NO_CODE: "Mention it when you contact us and we'll apply it.",
    START,
    ASK: "Ask about the offer",
  },
  HOSTING: {
    H1: "What we host",
    LEAD: "Some sites we can't host. Some we're happy to host after a quick review. Here's the list.",
    NEVER_H2: "We don't host",
    REVIEWED_H2: "We review these first",
    TAKEDOWN_H2: "If a live site breaks these rules",
    FOUND: "Found something?",
    REPORT_LINK: "Report it",
  },
  PRIVACY: {
    H1: "Privacy",
    DRAFT: "DRAFT: this notice has not been reviewed by a lawyer yet.",
    UPDATED: "Last updated",
  },
  UNSUB: {
    H1: "You're unsubscribed",
    BODY: "The old CDS newsletter has ended. You won't get any more emails from it. There's nothing else you need to do.",
    BACK_HOME: "Back to home",
  },
  REPORT: {
    ABUSE_LINE: MK_ABUSE_LINE,
    NEXT_H2: "What happens next",
    NEXT_STEPS: [
      "We review your report.",
      "If the content breaks the law or our rules, we remove it or turn the page off.",
      "We tell the site owner.",
      "The owner can send a counter-notice if they think we got it wrong.",
      "If the counter-notice is valid, we can restore the content after 10 to 14 business days.",
      "Sites that keep breaking copyright lose their place on CDS.",
    ],
    HOSTING_LINK: "What we host",
  },
  START: {
    PRIMARY: START,
  },
  NOT_FOUND: {
    H1: "We can't find that page.",
    BODY: "It may have moved.",
    HOME: "Go to the home page",
    ADDONS: "See all add-ons",
    ADDON_H1: "We can't find that add-on.",
    ADDON_BODY: "It may have been renamed or retired.",
  },
  COMMON: {
    COMING_SOON: "Coming soon",
    DRAFT: "DRAFT",
    NEW_TAB: "(opens in a new tab)",
  },
  SEO: {
    HOME_TITLE:
      "Connections Design Studios: websites built and run for small businesses",
    HOME_DESCRIPTION:
      "Pick a path and the parts you need. Pay one build fee, then one monthly price, month to month. Support is in every plan.",
    ORG_NAME: "Connections Design Studios",
    STANDARD_TITLE: "Standard · Connections Design Studios",
    STUDIO_TITLE: "Studio · Connections Design Studios",
    ADDONS_TITLE: "Add-ons · Connections Design Studios",
    PRICING_TITLE: "Pricing · Connections Design Studios",
    WORK_TITLE: "Our work · Connections Design Studios",
    ABOUT_TITLE: "About CDS · Connections Design Studios",
    CONTACT_TITLE: "Contact us · Connections Design Studios",
    INDIE_TITLE: "Going out on your own? · Connections Design Studios",
    HOSTING_TITLE: "What we host · Connections Design Studios",
    PRIVACY_TITLE: "Privacy · Connections Design Studios",
    UNSUB_TITLE: "You're unsubscribed · Connections Design Studios",
  },
} as const;

/** "No add-ons for Standard yet. Your site already includes pages, hosting and support." */
export function noAddonsOnPath(pathName: string): string {
  return `No add-ons for ${pathName} yet. Your site already includes pages, hosting and support.`;
}

/** /start preselect info line (HUB-02, UI-SPEC Registration entry). */
export function addonPreselectedLine(name: string): string {
  return `We added ${name} from the add-ons page. Untick it if you don't need it.`;
}

/** Contact success line; the call topic asks to set up a time. */
export function contactSentLine(email: string, isCall: boolean): string {
  return isCall
    ? `We'll email ${email} to set up a time.`
    : `We'll reply to ${email} by email.`;
}

/** Contact `?about=` prefill for Message. */
export function contactAboutPrefill(name: string): string {
  return `I'd like to know more about ${name}.`;
}

/** Message counter: "1,240 of 2,000". */
export function messageCounterLine(count: number, max = 2000): string {
  const f = new Intl.NumberFormat("en-US");
  return `${f.format(count)} of ${f.format(max)}`;
}

/** Independent-pro code line, only when INDEPENDENT_PRO_CODE is set. */
export function independentProCodeLine(code: string): string {
  return `Use code ${code} at checkout.`;
}

/** Add-on detail page title: "<Name> · CDS add-on". */
export function addonSeoTitle(name: string): string {
  return `${name} · CDS add-on`;
}

/** Add-on number label: "No. 04". */
export function swatchNumberLabel(n: number): string {
  return `No. ${String(n).padStart(2, "0")}`;
}

/** Footer bottom line: "© 2026 Connections Design Studios" (year from the server clock). */
export function copyrightLine(year: number): string {
  return `© ${year} Connections Design Studios`;
}

/** Footnote tail: "Checked September 24, 2026." (date text from formatCheckedDate). */
export function checkedLine(dateText: string): string {
  return `Checked ${dateText}.`;
}

/** Calculator CDS row label; the rate text comes from the Stripe claim. */
export function calcGatewayFeesLabel(rateText: string): string {
  return `Your gateway's fees (Stripe ${rateText} online), paid to Stripe`;
}

/** Calculator processing label; rate texts come from the claims. */
export function calcProcessingLabel(lowRate: string, highRate: string): string {
  return `Card processing online at Mindbody and Boulevard (${lowRate} to ${highRate} a sale)`;
}

/** Calculator live region; every figure is pre-formatted by the caller. */
export function calcLiveLine(elsewhere: string, cds: string): string {
  return `Elsewhere, you pay ${elsewhere} a month. With CDS, you pay ${cds}: Stripe's fees plus your plan.`;
}

/**
 * Calculator live region while the plan is unpriced: never "you pay Price coming soon" (WR-C01).
 * The elsewhere figure is pre-formatted by the caller.
 */
export function calcLiveLineNoPlan(elsewhere: string): string {
  return `Elsewhere, you pay ${elsewhere} a month. With CDS, your plan price is coming soon.`;
}

/** No-JS calculator caption; figures formatted from CALC_DEFAULTS at render. */
export function calcStaticCaption(sales: string, avg: string): string {
  return `Example: ${sales} in card sales a month, ${avg} average sale, no app clients.`;
}

/** FormulaCard sr-only sentence: "Standard plus Newsletter comes to <total a month>." */
export function formulaSentence(
  parts: readonly string[],
  total: string,
): string {
  return `${parts.join(" plus ")} comes to ${total}.`;
}

// Calculator input bounds (CALC_BOUNDS). Not prices: the only `$`+digit keys allowed.
export const CALC_ERR_SALES = "Enter an amount from $0 to $1,000,000.";
export const CALC_ERR_AVG = "Enter an average sale from $1 to $10,000.";
export const CALC_ERR_COUNT = "Enter a whole number from 0 to 1,000.";
