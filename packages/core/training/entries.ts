// Core training entries (CONT-32, D281, D87, D110; CONTEXT A4-Q4).
//
// One entry per core block, per column item kind and per core feature. Training is
// versioned with the code and identical for every tenant (the core counterpart of each
// add-on's training/ module, invariant 4), so it is never stored per organization.
// The text lives in docs/how-to (one source); these entries only point at it. P11 renders
// training in the dashboard; `video` stays null until the Remotion + Venice AI videos exist.

import type { TrainingEntry, TrainingModule } from "./types";
import * as p7BlocksA from "./p7/blocks-a";
import * as p7BlocksB from "./p7/blocks-b";
import * as p7Items from "./p7/items";
import * as p7Media from "./p7/media";
import * as p7Forms from "./p7/forms";
import * as p7Inbox from "./p7/inbox";
import * as p7Contacts from "./p7/contacts";
import * as p7Consent from "./p7/consent";
import * as p7Chrome from "./p7/chrome";
import * as p7SiteSettings from "./p7/site-settings";
import * as p7History from "./p7/history";
import * as p7Seo from "./p7/seo";
import * as p7Search from "./p7/search";
import * as p7Protected from "./p7/protected";
import * as p8Assembly from "./p8/assembly";
import * as p8Blocks from "./p8/blocks";
import * as p11Shell from "./p11/shell";
import * as p11Pages from "./p11/pages";
import * as p11Growth from "./p11/growth";
import * as p12Support from "./p12/support";
import * as p13Console from "./p13/console";
import * as p14Domains from "./p14/domains";

export type { TrainingEntry, TrainingModule } from "./types";

/**
 * The P7 training modules, one per owning plan (07-02). Each plan fills only its own
 * training/p7/<area>.ts; CORE_TRAINING and P7_FEATURES pick them up without editing this file.
 */
export const P7_TRAINING_MODULES: readonly TrainingModule[] = Object.freeze([
  p7BlocksA,
  p7BlocksB,
  p7Items,
  p7Media,
  p7Forms,
  p7Inbox,
  p7Contacts,
  p7Consent,
  p7Chrome,
  p7SiteSettings,
  p7History,
  p7Seo,
  p7Search,
  p7Protected,
]);

/** Feature ids declared by the P7 modules (each is a feature-kind entry of its module). */
export const P7_FEATURES: readonly string[] = Object.freeze(
  P7_TRAINING_MODULES.flatMap((m) => m.features),
);

/**
 * The P8 training modules (08-04): p8/assembly (08-09 fills it) and p8/blocks, appended by
 * 08-05 in the commit that registers the Services and Our team blocks.
 */
export const P8_TRAINING_MODULES: readonly TrainingModule[] = Object.freeze([
  p8Assembly,
  p8Blocks,
]);

/** Feature ids declared by the P8 modules. */
export const P8_FEATURES: readonly string[] = Object.freeze(
  P8_TRAINING_MODULES.flatMap((m) => m.features),
);

/**
 * The P11 training modules (11-43): p11/shell (11-43), p11/pages (11-44 fills it) and
 * p11/growth (11-45 fills it). Owning plans fill only their own module, never this file.
 */
export const P11_TRAINING_MODULES: readonly TrainingModule[] = Object.freeze([
  p11Shell,
  p11Pages,
  p11Growth,
]);

/** Feature ids declared by the P11 modules. */
export const P11_FEATURES: readonly string[] = Object.freeze(
  P11_TRAINING_MODULES.flatMap((m) => m.features),
);

/** The P12 training modules (12-33): p12/support (CDS Support, notices, paid services). */
export const P12_TRAINING_MODULES: readonly TrainingModule[] = Object.freeze([
  p12Support,
]);

/** Feature ids declared by the P12 modules. */
export const P12_FEATURES: readonly string[] = Object.freeze(
  P12_TRAINING_MODULES.flatMap((m) => m.features),
);

/** The P13 training modules (13-50): p13/console (ticket ratings, content notices). */
export const P13_TRAINING_MODULES: readonly TrainingModule[] = Object.freeze([
  p13Console,
]);

/** Feature ids declared by the P13 modules. */
export const P13_FEATURES: readonly string[] = Object.freeze(
  P13_TRAINING_MODULES.flatMap((m) => m.features),
);

/**
 * The P14 training modules (14-46): p14/domains (domain, DNS records, email setup, sending,
 * launch review, preview links, leaving CDS).
 */
export const P14_TRAINING_MODULES: readonly TrainingModule[] = Object.freeze([
  p14Domains,
]);

/** Feature ids declared by the P14 modules. */
export const P14_FEATURES: readonly string[] = Object.freeze(
  P14_TRAINING_MODULES.flatMap((m) => m.features),
);

/** The P3-P6 entries, written out here. */
const BASE_TRAINING = [
  // Blocks: ids are the section types in CORE_SECTIONS.
  {
    id: "columns",
    title: "Columns block",
    requirement: "CONT-05",
    kind: "block",
    howTo: "docs/how-to/block-columns.md",
    video: null,
  },
  {
    id: "hero",
    title: "Hero block",
    requirement: "CONT-03",
    kind: "block",
    howTo: "docs/how-to/block-hero.md",
    video: null,
  },
  {
    id: "text-image",
    title: "Text & image block",
    requirement: "CONT-03",
    kind: "block",
    howTo: "docs/how-to/block-text-image.md",
    video: null,
  },
  {
    id: "text-only",
    title: "Text block",
    requirement: "CONT-03",
    kind: "block",
    howTo: "docs/how-to/block-text-only.md",
    video: null,
  },
  {
    id: "cta-banner",
    title: "Call to action block",
    requirement: "CONT-03",
    kind: "block",
    howTo: "docs/how-to/block-cta-banner.md",
    video: null,
  },
  // Column items: ids are "item:<kind>" for each COLUMN_ITEM_KINDS entry.
  {
    id: "item:heading",
    title: "Heading item",
    requirement: "CONT-03",
    kind: "item",
    howTo: "docs/how-to/item-heading.md",
    video: null,
  },
  {
    id: "item:text",
    title: "Text item",
    requirement: "CONT-09",
    kind: "item",
    howTo: "docs/how-to/item-text.md",
    video: null,
  },
  {
    id: "item:list",
    title: "List item",
    requirement: "CONT-03",
    kind: "item",
    howTo: "docs/how-to/item-list.md",
    video: null,
  },
  {
    id: "item:image",
    title: "Image item",
    requirement: "CONT-03",
    kind: "item",
    howTo: "docs/how-to/item-image.md",
    video: null,
  },
  {
    id: "item:button",
    title: "Button item",
    requirement: "CONT-12",
    kind: "item",
    howTo: "docs/how-to/item-button.md",
    video: null,
  },
  {
    id: "item:spacer",
    title: "Spacer item",
    requirement: "CONT-03",
    kind: "item",
    howTo: "docs/how-to/item-spacer.md",
    video: null,
  },
  {
    id: "item:divider",
    title: "Divider item",
    requirement: "CONT-03",
    kind: "item",
    howTo: "docs/how-to/item-divider.md",
    video: null,
  },
  {
    id: "item:countdown",
    title: "Countdown item",
    requirement: "CONT-10",
    kind: "item",
    howTo: "docs/how-to/item-countdown.md",
    video: null,
  },
  // Core features.
  {
    id: "banner",
    title: "Announcement banner",
    requirement: "CONT-11",
    kind: "feature",
    howTo: "docs/how-to/announcement-banner.md",
    video: null,
  },
  {
    id: "popups",
    title: "Pop-ups",
    requirement: "CONT-12",
    kind: "feature",
    howTo: "docs/how-to/popups.md",
    video: null,
  },
  {
    id: "publish",
    title: "Preview and publish a page",
    requirement: "CONT-30",
    kind: "feature",
    howTo: "docs/how-to/publish-page.md",
    video: null,
  },
  {
    id: "pages",
    title: "Sign in and manage pages",
    requirement: "CONT-08",
    kind: "feature",
    howTo: "docs/how-to/pages-and-sign-in.md",
    video: null,
  },
  {
    id: "theming",
    title: "Theme import",
    requirement: "THEME-03",
    kind: "feature",
    howTo: "docs/how-to/theme-import.md",
    video: null,
  },
  // Phase 6 setup and settings features (06-23; D110).
  {
    id: "setup",
    title: "Set up your site",
    requirement: "ONB-02",
    kind: "feature",
    howTo: "docs/how-to/set-up-your-site.md",
    video: null,
  },
  {
    id: "team-hours",
    title: "Team and opening hours",
    requirement: "ONB-13",
    kind: "feature",
    howTo: "docs/how-to/team-and-hours.md",
    video: null,
  },
  // 08-04: was "services"; renamed so the Services block (section type) owns that id.
  {
    id: "services-list",
    title: "Services",
    requirement: "ONB-13",
    kind: "feature",
    howTo: "docs/how-to/services.md",
    video: null,
  },
  {
    id: "email-routing",
    title: "Where your email goes",
    requirement: "ONB-09",
    kind: "feature",
    howTo: "docs/how-to/email-routing.md",
    video: null,
  },
  {
    id: "mood-board",
    title: "Mood board",
    requirement: "ONB-05",
    kind: "feature",
    howTo: "docs/how-to/mood-board.md",
    video: null,
  },
] satisfies TrainingEntry[];

export const CORE_TRAINING: readonly TrainingEntry[] = Object.freeze([
  ...BASE_TRAINING,
  ...P7_TRAINING_MODULES.flatMap((m) => m.entries),
  ...P8_TRAINING_MODULES.flatMap((m) => m.entries),
  ...P11_TRAINING_MODULES.flatMap((m) => m.entries),
  ...P12_TRAINING_MODULES.flatMap((m) => m.entries),
  ...P13_TRAINING_MODULES.flatMap((m) => m.entries),
  ...P14_TRAINING_MODULES.flatMap((m) => m.entries),
]);

const BY_ID: ReadonlyMap<string, TrainingEntry> = new Map(
  CORE_TRAINING.map((e) => [e.id, e]),
);

/** The training entry for a block type, "item:<kind>" or feature id, if there is one. */
export function trainingFor(id: string): TrainingEntry | undefined {
  return BY_ID.get(id);
}
