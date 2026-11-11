// P14 training: domains, DNS, launch review, preview links and leaving CDS (owner 14-46;
// DOM-02, DOM-03, DOM-07, DOM-10, LIFE-01, ONB-10, D110).
//
// Owner-facing feature entries only. Staff how-tos (route /staff… or npm run …; 14-47) never
// get an entry here (T-14-46-01, T-13-50-01). Audiences follow the screens: Settings › Domain,
// its DNS records and email setup views, Integrations and /hub/review are readable by Owner and
// Admin (their "?" must open for both), so those are ownerAdminOnly; Leaving CDS is Owner only;
// preview links sit in the page builder, so every role reads them. "email-address" keeps its
// P6 help id (Settings › Email links to /hub/help/email-address). Every entry's howTo must
// exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "connect-your-domain",
    title: "Connect your domain",
    requirement: "DOM-02",
    kind: "feature",
    howTo: "docs/how-to/connect-your-domain.md",
    video: null,
  },
  {
    id: "add-a-dns-record",
    title: "Add a DNS record",
    requirement: "DOM-03",
    kind: "feature",
    howTo: "docs/how-to/add-a-dns-record.md",
    video: null,
  },
  {
    id: "set-up-email-for-your-domain",
    title: "Set up email for your domain",
    requirement: "DOM-03",
    kind: "feature",
    howTo: "docs/how-to/set-up-email-for-your-domain.md",
    video: null,
  },
  {
    id: "email-address",
    title: "Get an email address at your own domain",
    requirement: "ONB-10",
    kind: "feature",
    howTo: "docs/how-to/professional-email-address.md",
    video: null,
  },
  {
    id: "review-your-site-before-launch",
    title: "Review your site before launch",
    requirement: "DOM-10",
    kind: "feature",
    howTo: "docs/how-to/review-your-site-before-launch.md",
    video: null,
  },
  {
    id: "preview-links",
    title: "Preview links",
    requirement: "DOM-07",
    kind: "feature",
    howTo: "docs/how-to/preview-links.md",
    video: null,
  },
  {
    id: "leaving-cds",
    title: "Leaving CDS",
    requirement: "LIFE-01",
    kind: "feature",
    howTo: "docs/how-to/leaving-cds.md",
    video: null,
  },
]);

export const features: readonly string[] = Object.freeze(
  entries.map((e) => e.id),
);

/** Owner only: starting the notice and the DNS handback are Owner actions. */
export const ownerOnly: readonly string[] = Object.freeze(["leaving-cds"]);

/** Owner acts, Admin reads the screen (domain:read, launch_review read). */
export const ownerAdminOnly: readonly string[] = Object.freeze([
  "connect-your-domain",
  "add-a-dns-record",
  "set-up-email-for-your-domain",
  "email-address",
  "review-your-site-before-launch",
]);
