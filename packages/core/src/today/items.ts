// Needs-you items: the one source for the Today list, sidebar/tab badges and bell clearing
// (DASH-20, DASH-27, DASH-37). Pure and browser-safe: no database package, no React.

/** A hub section a Needs-you item (and its badge) belongs to. */
export type SectionKey =
  | "today"
  | "inbox"
  | "website"
  | "marketing"
  | "reports"
  | "settings"
  | "addons"
  | "help"
  | "support"
  | `addon:${string}`;

export type NeedsYouLevel = "urgent" | "normal";

export type NeedsYouItem = {
  /** Stable key, e.g. `inbox:<msgId>`, `billing:fix_card`. */
  key: string;
  kind: string;
  level: NeedsYouLevel;
  title: string;
  sub?: string;
  /** Still-needed intake items the owner may skip. */
  optional?: boolean;
  actionLabel: string;
  /** Relative hub link; must pass `isHubHref` (T-11-04-01). */
  href: string;
  section: SectionKey;
  tab?: string;
  /** ISO timestamp the item became due. */
  at: string;
};

export type NeedsYouCounts = {
  bySection: Record<string, number>;
  /** Keyed `section:tab`. */
  byTab: Record<string, number>;
};

/** `.` or `..` as a whole path segment, raw or as `%2e` (WR-C03). */
const HUB_HREF_DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;

/**
 * True only for a relative hub link: `/hub` or `/hub/...`, `?...`, `#...`. Rejects absolute
 * URLs, protocol-relative `//x`, backslashes and any `//` in the path (open redirect guard,
 * T-11-04-01), and dot segments or encoded slashes that would leave /hub (WR-C03). Every
 * Needs-you provider and every alert href must pass it.
 */
export function isHubHref(href: string): boolean {
  if (typeof href !== "string" || href.length === 0 || href.length > 2048)
    return false;
  if (href.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(href)) return false;
  if (!/^\/hub(?:[/?#]|$)/.test(href)) return false;
  const path = href.split(/[?#]/, 1)[0] ?? "";
  if (path.includes("//")) return false;
  // WR-C03: a dot segment (raw or percent-encoded) would normalise out of /hub, and an
  // encoded slash or backslash could do the same on the server.
  if (HUB_HREF_DOT_SEGMENT.test(path)) return false;
  return !/%(?:2f|5c)/i.test(path);
}

function atMs(at: string): number {
  const t = Date.parse(at);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Urgent first, then oldest `at` first, then key. Returns a new array. */
export function sortNeedsYou(items: readonly NeedsYouItem[]): NeedsYouItem[] {
  return [...items].sort((a, b) => {
    if (a.level !== b.level) return a.level === "urgent" ? -1 : 1;
    const d = atMs(a.at) - atMs(b.at);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** Badge counts: by section, and by `section:tab` for items with a tab. */
export function groupCounts(items: readonly NeedsYouItem[]): NeedsYouCounts {
  const bySection: Record<string, number> = {};
  const byTab: Record<string, number> = {};
  for (const i of items) {
    bySection[i.section] = (bySection[i.section] ?? 0) + 1;
    if (i.tab) {
      const k = `${i.section}:${i.tab}`;
      byTab[k] = (byTab[k] ?? 0) + 1;
    }
  }
  return { bySection, byTab };
}

/** Org stage values (same as the db package OrgStage; declared here to stay dependency-free). */
export type StageName =
  | "intake"
  | "fit_review"
  | "ready_for_build"
  | "being_built"
  | "ready_for_review"
  | "live"
  | "";

/** The one pre-launch predicate (DASH-32). */
export function isLive(stage: StageName | string | null | undefined): boolean {
  return stage === "live";
}

/** Status-line badge words by stage (UI-SPEC § 1). Stages before build have no line. */
export const STAGE_LINE: Readonly<Partial<Record<StageName, string>>> =
  Object.freeze({
    ready_for_build: "Being built",
    being_built: "Being built",
    ready_for_review: "Ready for your review",
    live: "Live",
  });
