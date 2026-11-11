// P11 training: hub shell, Today and alerts (owner 11-43; DASH-17, D110).
//
// Feature entries only; ids double as the help ids the screens use (`today`, …), resolved by
// 11-46. Every entry's howTo must exist in the same commit. Never import entries.ts.
import type { TrainingEntry } from "../types";

export const entries: readonly TrainingEntry[] = Object.freeze([
  {
    id: "today",
    title: "Today",
    requirement: "DASH-19",
    kind: "feature",
    howTo: "docs/how-to/today.md",
    video: null,
  },
  {
    id: "needs-you",
    title: "Needs you and the bell",
    requirement: "DASH-20",
    kind: "feature",
    howTo: "docs/how-to/needs-you-and-the-bell.md",
    video: null,
  },
  {
    id: "phone-alerts",
    title: "Alerts on your phone",
    requirement: "DASH-34",
    kind: "feature",
    howTo: "docs/how-to/alerts-on-your-phone.md",
    video: null,
  },
  {
    id: "alert-settings",
    title: "Alert settings",
    requirement: "DASH-36",
    kind: "feature",
    howTo: "docs/how-to/alert-settings.md",
    video: null,
  },
  {
    id: "switch-sites",
    title: "Switch between sites",
    requirement: "DASH-18",
    kind: "feature",
    howTo: "docs/how-to/switch-between-sites.md",
    video: null,
  },
  {
    id: "jump-to",
    title: "Jump to",
    requirement: "DASH-28",
    kind: "feature",
    howTo: "docs/how-to/jump-to.md",
    video: null,
  },
  {
    id: "help",
    title: "Help and tours",
    requirement: "DASH-17",
    kind: "feature",
    howTo: "docs/how-to/help-and-tours.md",
    video: null,
  },
]);

export const features: readonly string[] = Object.freeze([
  "today",
  "needs-you",
  "phone-alerts",
  "alert-settings",
  "switch-sites",
  "jump-to",
  "help",
]);
