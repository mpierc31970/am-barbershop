// AnalyticsSource port (11-06; DASH-10, DASH-11, D59, D196). GA4 and Search Console sit
// behind this port; the stand-in returns { connected: false } and the Site Report shows
// "Connects when CDS finishes setup" rather than an error. Pure types, browser-safe.

/** Inclusive calendar range in the business time zone. */
export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface NotConnected {
  connected: false;
}

export interface Ga4Summary {
  connected: true;
  users: number;
  sessions: number;
  topPages: { path: string; views: number }[];
}

export interface SearchQueries {
  connected: true;
  rows: { query: string; clicks: number; impressions: number }[];
}

export interface AnalyticsSource {
  ga4Summary(
    orgId: string,
    range: DateRange,
  ): Promise<Ga4Summary | NotConnected>;
  searchTopQueries(
    orgId: string,
    range: DateRange,
  ): Promise<SearchQueries | NotConnected>;
}

export const NOT_CONNECTED: NotConnected = Object.freeze({ connected: false });

export function isNotConnected(
  r: { connected: boolean } | null | undefined,
): r is NotConnected {
  return !r || r.connected === false;
}
