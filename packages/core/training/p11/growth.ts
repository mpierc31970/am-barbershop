// P11 training: social, growth, your data and people (owner 11-45; DASH-17, D110).
//
// Feature entries only; ids double as help ids (resolved by 11-46). Existing how-tos are
// linked, never duplicated: social-accounts → social-accounts.md (11-37), people-roles →
// people-and-roles.md (11-39). Reports and the monthly site email live in p11/pages.ts (11-44).
// The staff how-to (dashboard-staff-clis.md) gets no entry, so staff procedures never reach a
// tenant's Help (T-11-45-01). Every entry's howTo must exist in the same commit. Never import
// entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "social-accounts",
    title: "My social accounts and bio links",
    requirement: "DASH-14",
    kind: "feature",
    howTo: "docs/how-to/social-accounts.md",
    video: null,
  },
  {
    id: "grow-social",
    title: "Grow your social",
    requirement: "DASH-16",
    kind: "feature",
    howTo: "docs/how-to/grow-your-social.md",
    video: null,
  },
  {
    // Owner only (D285): 11-46 shows this article to Owners only.
    id: "download-data",
    title: "Download my data",
    requirement: "LIFE-04",
    kind: "feature",
    howTo: "docs/how-to/download-my-data.md",
    video: null,
  },
  {
    // Owners manage people and Admins read the tab; Editors and Viewers have no tab, so 11-46
    // shows this article to Owners and Admins only.
    id: "people-roles",
    title: "People & roles",
    requirement: "DASH-25",
    kind: "feature",
    howTo: "docs/how-to/people-and-roles.md",
    video: null,
  },
]);

export const features: readonly string[] = Object.freeze([
  "social-accounts",
  "grow-social",
  "download-data",
  "people-roles",
]);

/** Help shows these to Owners only (11-46 applies the filter). */
export const ownerOnly: readonly string[] = Object.freeze(["download-data"]);

/** Help shows these to Owners and Admins only (members:read; 11-46 applies the filter). */
export const ownerAdminOnly: readonly string[] = Object.freeze([
  "people-roles",
]);
