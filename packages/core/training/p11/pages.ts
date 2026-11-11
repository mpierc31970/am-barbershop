// P11 training: pages, reports and the remaining hub screens (owner 11-44; DASH-17, D110).
//
// Feature entries only; ids double as help ids (resolved by 11-46). Existing how-tos are
// linked, never duplicated: add-pages → page-allowance.md (11-28), delete-page →
// page-delete.md (11-30), site-report → reports.md (11-33). `profile` and `support` are the
// help ids of Your profile and alerts (11-24) and CDS Support (11-42), which had how-tos but
// no entry yet. Block presets already have the P7 `presets` entry; social accounts and people
// and roles are 11-45's (p11/growth.ts). Staff how-tos (monthly-site-email-job.md,
// staff-stage-and-announcements.md) get no entry, so they never reach a tenant's Help.
// Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "page-history",
    title: "Page history and restore",
    requirement: "DASH-07",
    kind: "feature",
    howTo: "docs/how-to/page-history-and-restore.md",
    video: null,
  },
  {
    // Buying and removing packs is Owner-only; 11-46 shows this article to Owners only
    // (T-11-44-01). Other roles see the "ask your site owner" line on the Pages tab.
    id: "add-pages",
    title: "Page allowance and Add 5 more pages",
    requirement: "DASH-08",
    kind: "feature",
    howTo: "docs/how-to/page-allowance.md",
    video: null,
  },
  {
    id: "delete-page",
    title: "Delete and restore a page",
    requirement: "DASH-06",
    kind: "feature",
    howTo: "docs/how-to/page-delete.md",
    video: null,
  },
  {
    id: "site-report",
    title: "Read your Reports",
    requirement: "DASH-11",
    kind: "feature",
    howTo: "docs/how-to/reports.md",
    video: null,
  },
  {
    id: "monthly-email",
    title: "Monthly site email",
    requirement: "DASH-12",
    kind: "feature",
    howTo: "docs/how-to/monthly-site-email.md",
    video: null,
  },
  {
    id: "profile",
    title: "Your profile and alerts",
    requirement: "DASH-36",
    kind: "feature",
    howTo: "docs/how-to/profile-and-alerts.md",
    video: null,
  },
  {
    id: "support",
    title: "CDS Support",
    requirement: "DASH-24",
    kind: "feature",
    howTo: "docs/how-to/cds-support.md",
    video: null,
  },
]);

export const features: readonly string[] = Object.freeze([
  "page-history",
  "add-pages",
  "delete-page",
  "site-report",
  "monthly-email",
  "profile",
  "support",
]);

/**
 * Entries whose how-to is about buying or billing: Help shows them to Owners only
 * (T-11-44-01; 11-46 applies the filter).
 */
export const ownerOnly: readonly string[] = Object.freeze(["add-pages"]);
