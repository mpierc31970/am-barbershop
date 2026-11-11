// Indexing copy (13-39; STAFF-17, D190; 13-UI-SPEC "Indexing" lines 911-915, dialog line 1086).
// The Resubmit all dialog title / buttons stay in @cds/core/staff P13_DIALOGS.resubmit_all.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";

export const INDEXING_COPY = {
  heading: "Indexing",
  caption: "Search indexing for each site",
  cols: {
    site: "Site",
    ping: "Last ping",
    sitemap: "Sitemap",
    pages: "Pages indexed",
    resubmit: "Last resubmit",
    action: "Action",
  },
  sitemap: { ok: "OK", error: "Error", unchecked: "Not checked" },
  ping: {
    logged: "logged (stand-in)",
    ok: "OK",
    error: "error",
    skipped: "skipped (demo)",
    never: "Never",
  },
  none: "—",
  pagesTitle: "Available once Search Console is connected",
  demo: "Demo",
  resubmitNow: "Resubmit now",
  resubmitLabel: (business: string) => `Resubmit now: ${business}`,
  resubmitAll: "Resubmit all live sites",
  demoSkipped: "The demo site is skipped.",
  liveSites: "Live sites",
  noLiveSites: "No live sites to resubmit.",
  empty: "No live sites yet. Sites show here once they go live.",
  schedule: (lastRun: string | null) =>
    lastRun
      ? `Runs by itself every Sunday. Last run ${lastRun}.`
      : "Runs by itself every Sunday. Not run yet.",
} as const;

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: BUSINESS_TIME_ZONE,
});

const FULL = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: BUSINESS_TIME_ZONE,
});

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(t) ? new Date(t) : null;
}

/** "2 Oct" in Central; null when missing or unreadable. */
export function formatIndexingDay(
  value: string | null | undefined,
): string | null {
  const d = parse(value);
  return d ? DAY.format(d) : null;
}

/** "Oct 2, 2026, 6:00 AM" in Central (cell titles); null when missing. */
export function formatIndexingTime(
  value: string | null | undefined,
): string | null {
  const d = parse(value);
  return d ? FULL.format(d) : null;
}
