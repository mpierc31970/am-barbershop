// Settings › Integrations view model (14-32 choice 4; CONT-16, D190, D312; 14-UI-SPEC
// "Integrations"; D-UI-P14-25; T-14-32-03). Pure. Before launch the panel shows NotLiveYet with
// INTEG-PRELAUNCH; once live, four read-only rows: Google Analytics, Google Search Console, Bing
// Webmaster Tools and Instant updates (IndexNow). Stand-in results (`logged`) read exactly like
// real ones (`ok`): owners never see "(stand-in)" (staff do, in the console). "Not connected" is
// ink-muted, never an error. The only id shown is the GA4 measurement id.
import { P14_COPY } from "@cds/core/dns";
import type { OwnerSearchStatus } from "@cds/db";
import { formatDomainDate } from "./domain-view";

export const INTEGRATIONS_COPY = Object.freeze({
  heading: "Search engines and analytics",
  intro: "CDS sets these up. Ask CDS Support to change them.",
  ga: "Google Analytics",
  gsc: "Google Search Console",
  bing: "Bing Webmaster Tools",
  indexnow: "Instant updates (IndexNow)",
  notConnected: "Not connected",
  gaOn: (id: string) => `${id} · loads only after visitors accept cookies`,
  gscOn: "Connected",
  gscSent: (date: string) => `Connected · sitemap sent ${date}`,
  bingSent: (date: string) => `Sitemap sent ${date}`,
  indexnowOn: "On",
  indexnowLast: (ago: string) =>
    `On · search engines told about your last change ${ago}`,
  yourDomain: "your own domain",
});

const C = INTEGRATIONS_COPY;

export type IntegrationRow = {
  key: "ga" | "gsc" | "bing" | "indexnow";
  label: string;
  value: string;
  /** "Not connected": ink-muted. */
  muted: boolean;
};

export type IntegrationsView =
  { live: false; prelaunch: string } | { live: true; rows: IntegrationRow[] };

const sent = (r: string | null): boolean => r === "ok" || r === "logged";

/** "just now" / "5 minutes ago" / "2 hours ago" / "3 days ago". */
export function agoWords(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.floor(Math.max(0, now.getTime() - t) / 60_000);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"} ago`;
  if (min < 1) return "just now";
  if (min < 60) return plural(min, "minute");
  const h = Math.floor(min / 60);
  if (h < 24) return plural(h, "hour");
  return plural(Math.floor(h / 24), "day");
}

export function buildIntegrationsView(
  status: OwnerSearchStatus,
  opts: { domain: string | null; now?: Date },
): IntegrationsView {
  if (!status.live) {
    return {
      live: false,
      prelaunch: P14_COPY.INTEG_PRELAUNCH({
        domain: opts.domain ?? C.yourDomain,
      }),
    };
  }
  const now = opts.now ?? new Date();
  const submitted =
    sent(status.lastSubmitResult) && status.lastSubmitAt
      ? formatDomainDate(status.lastSubmitAt)
      : null;
  const pinged =
    sent(status.lastPingResult) && status.lastPingAt
      ? agoWords(status.lastPingAt, now)
      : null;
  const row = (
    key: IntegrationRow["key"],
    label: string,
    value: string | null,
  ): IntegrationRow => ({
    key,
    label,
    value: value ?? C.notConnected,
    muted: value === null,
  });
  return {
    live: true,
    rows: [
      row(
        "ga",
        C.ga,
        status.ga4MeasurementId ? C.gaOn(status.ga4MeasurementId) : null,
      ),
      row(
        "gsc",
        C.gsc,
        status.searchConsole
          ? submitted
            ? C.gscSent(submitted)
            : C.gscOn
          : null,
      ),
      row("bing", C.bing, submitted ? C.bingSent(submitted) : null),
      row(
        "indexnow",
        C.indexnow,
        pinged ? C.indexnowLast(pinged) : C.indexnowOn,
      ),
    ],
  };
}
