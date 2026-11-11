// Reports copy and formatters (11-33; 11-UI-SPEC "Reports" lines 741-802, Copywriting
// Contract: REPORTS-PRELAUNCH, SPEED-PRELAUNCH, SOCIAL-PRELAUNCH, ERR-SECTION, SOURCES-HELP,
// SPEED-HELP, SPEED-FEW, NOTFOUND-HELP, GA4-NOTE, SOCIAL-EMPTY verbatim). Pure, browser-safe.
import type { VitalMetric, VitalRating } from "@cds/core/analytics";
import { SOCIAL_PRESETS } from "@cds/core/social";

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export const DEFAULT_REPORT_PERIOD: ReportPeriod = 30;

export const REPORTS_COPY = Object.freeze({
  /** REPORTS-PRELAUNCH */
  prelaunch: "Your first numbers appear a day after launch.",
  /** SPEED-PRELAUNCH */
  speedPrelaunch:
    "Speed is measured from real visitors, so it shows after launch.",
  /** SOCIAL-PRELAUNCH */
  socialPrelaunch: "Visits from your bio links show here after launch.",
  /** ERR-SECTION */
  errSection: "We couldn't load this part. The rest of the page is fine.",
  tryAgain: "Try again",
  /** SOURCES-HELP */
  sourcesHelp:
    '"Bio link" means the visit came from a link you copied from Marketing › Social.',
  /** SPEED-HELP */
  speedHelp:
    "Measured on your visitors' own phones and computers. Most sites aim for Good on all three.",
  /** SPEED-FEW */
  speedFew: "Not enough visits yet to measure speed. We need about 20.",
  /** NOTFOUND-HELP */
  notFoundHelp:
    "Someone opened an address on your site that doesn't exist. Check your menu and buttons for an old link.",
  notFoundNone: "No broken addresses in this period.",
  /** GA4-NOTE (D189) */
  ga4Note:
    "Google Analytics only counts visitors who accept cookies, so its numbers run lower than the visitor count above.",
  /** SOCIAL-EMPTY */
  socialEmpty:
    "No visits from your bio links yet. Add your bio links to start counting them.",
  socialEmptyLink: "Add your bio links",
  socialFootnote:
    "Counts visits from your bio links and from social sites that pass their address. Follower counts aren't shown.",
  notConnected: "Connects when Support finishes setup.",
  notConnectedNote:
    "Support sets this up for you under our Google account. Ask Support if you'd like access.",
  showTable: "Show as table",
  showChart: "Show as chart",
  showAll: (n: number) => `Show all ${n}`,
  seoAllClear: "Nothing to fix right now.",
  seoTopFixes: "Top fixes",
  seoChecked: (when: string) => `Checked ${when} from your published pages.`,
  fixOn: (page: string) => `Fix on ${page}`,
  noRows: "Nothing in this period.",
  searchesNone: "No Google searches showed your site in this period.",
  openInbox: "Open Inbox",
  periodLabel: "Report period",
  periodName: (days: number) => `Last ${days} days`,
  vsPrevious: (days: number) => `vs the previous ${days} days`,
});

export const REPORT_SECTION_TITLES = Object.freeze({
  summary: "Summary",
  visitors: "Visitors by day",
  topPages: "Top pages",
  sources: "Where visitors come from",
  seo: "SEO health",
  speed: "Page speed",
  forms: "Messages from your forms",
  notFound: "Pages not found",
  searches: "What people searched on Google",
  ga4: "Google Analytics",
  social: "Visits from social",
});

/** Resolves `?period=` to 7, 30 or 90 (default 30). */
export function resolveReportPeriod(raw: unknown): ReportPeriod {
  const value = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  const n = typeof value === "string" ? Number(value) : value;
  return (REPORT_PERIODS as readonly unknown[]).includes(n)
    ? (n as ReportPeriod)
    : DEFAULT_REPORT_PERIOD;
}

const NUMBER = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return NUMBER.format(Number.isFinite(n) ? Math.round(n) : 0);
}

export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "18%" (whole percent); 0 when the total is 0. */
export function formatShare(part: number, total: number): string {
  if (!(total > 0)) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dayParts(day: string): Date | null {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** "3 Oct" for a YYYY-MM-DD business day. */
export function formatDayShort(day: string): string {
  const d = dayParts(day);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : day;
}

/** "Fri 3 Oct" for a YYYY-MM-DD business day. */
export function formatDayLong(day: string): string {
  const d = dayParts(day);
  return d ? `${WEEKDAYS[d.getUTCDay()]} ${formatDayShort(day)}` : day;
}

export type Delta = {
  direction: "up" | "down" | "same" | "new";
  words: string;
};

/** Plain-word change vs the previous period (D-UI-P11-9: arrow + words, never colour alone). */
export function deltaWords(now: number, prev: number, days: number): Delta {
  const vs = REPORTS_COPY.vsPrevious(days);
  if (now === prev)
    return { direction: "same", words: `Same as the previous ${days} days` };
  if (prev <= 0) return { direction: "new", words: `Up from none ${vs}` };
  const pct = Math.round((Math.abs(now - prev) / prev) * 100);
  return now > prev
    ? { direction: "up", words: `Up ${pct}% ${vs}` }
    : { direction: "down", words: `Down ${pct}% ${vs}` };
}

/** Source label for the Sources table: Google, Direct, Instagram, a host. */
export function sourceLabel(source: string): string {
  const s = source.trim().toLowerCase();
  if (s === "" || s === "direct") return "Direct";
  const preset = SOCIAL_PRESETS.find((p) => p.key === s);
  if (preset) return preset.label;
  const named: Record<string, string> = {
    google: "Google",
    bing: "Bing",
    duckduckgo: "DuckDuckGo",
    yahoo: "Yahoo",
    other: "Other sites",
  };
  return named[s] ?? source;
}

/** The P7 brand-icon id for a social source, or null. */
export function sourceIcon(source: string): string | null {
  return SOCIAL_PRESETS.find((p) => p.key === source)?.icon ?? null;
}

export const SPEED_ROWS: readonly {
  metric: VitalMetric;
  label: string;
  code: string;
}[] = Object.freeze([
  { metric: "lcp", label: "Loading", code: "LCP" },
  { metric: "inp", label: "Responsiveness", code: "INP" },
  { metric: "cls", label: "Visual stability", code: "CLS" },
]);

export const SPEED_WORDS: Readonly<Record<VitalRating, string>> = Object.freeze(
  {
    good: "Good",
    "needs-work": "Needs work",
    poor: "Poor",
  },
);

/** "2.1 s" (LCP), "180 ms" (INP), "0.05" (CLS). */
export function formatVital(metric: VitalMetric, value: number): string {
  if (metric === "cls") return value.toFixed(2);
  if (metric === "lcp") return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}

export type SeoWord = { word: string; tone: "done" | "needed" | "bouncing" };

/** Score word badge (UI-SPEC section 5): >= 90 Great, 70-89 Good, 50-69 Needs work, < 50 Needs attention. */
export function seoWord(score: number): SeoWord {
  if (score >= 90) return { word: "Great", tone: "done" };
  if (score >= 70) return { word: "Good", tone: "done" };
  if (score >= 50) return { word: "Needs work", tone: "needed" };
  return { word: "Needs attention", tone: "bouncing" };
}
