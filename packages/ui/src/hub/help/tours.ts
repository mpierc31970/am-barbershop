// First-use tours (11-48; DASH-17, D208; 11-UI-SPEC "First-use tours" lines 612-630,
// D-UI-P11-17). Pure data, client-safe (no "use client": server actions import isTourId).
// Each step points at a `data-tour="<anchor>"` element on its screen and names the how-to
// "Use" (or "Activate") row it summarises (`howTo` + `table` + `row`), plus a `term` that must appear in that row, so
// the coachmark and the how-to can't drift apart (tour.dom.test.tsx reads the markdown).
// The coachmark copy is the short form (title + at most two sentences); the how-to row is the
// full recording script.

export const TOUR_IDS = ["today", "builder", "addons", "media"] as const;
export type TourId = (typeof TOUR_IDS)[number];

export type TourStepDef = {
  /** `data-tour` value of the element this step points at. */
  anchor: string;
  title: string;
  /** One or two sentences. */
  body: string;
  /** The how-to whose Use row this step summarises. */
  howTo: string;
  /** Which table of the how-to (default "use"). */
  table?: "activate" | "use";
  /** 1-based row number in that table. */
  row: number;
  /** A word or control name that appears in that row (drift check). */
  term: string;
};

export type TourStepView = Pick<TourStepDef, "anchor" | "title" | "body">;

const TODAY = "docs/how-to/today.md";
const PAGES_HISTORY = "docs/how-to/page-history-and-restore.md";
const PUBLISH = "docs/how-to/publish-page.md";
const PRESETS = "docs/how-to/block-presets.md";
const ADDONS = "docs/how-to/addons-get-add-ons.md";
const MEDIA = "docs/how-to/media-library.md";

export const TOURS: Readonly<Record<TourId, readonly TourStepDef[]>> =
  Object.freeze({
    today: [
      {
        anchor: "today-status",
        title: "Where your site stands",
        body: "The line under the greeting shows your site's stage, from being built to live.",
        howTo: TODAY,
        row: 1,
        term: "greeting",
      },
      {
        anchor: "today-needs-you",
        title: "Needs you",
        body: "Things only you can finish, most urgent first. Each button opens the screen that finishes it.",
        howTo: TODAY,
        row: 5,
        term: "Needs you",
      },
      {
        anchor: "today-cards",
        title: "Your day",
        body: "Cards for your messages and add-ons, each with a link to see more.",
        howTo: TODAY,
        row: 6,
        term: "Your day",
      },
      {
        anchor: "today-customize",
        title: "Customize",
        body: "Choose which cards show and in what order. Only you see this.",
        howTo: TODAY,
        row: 7,
        term: "Customize",
      },
    ],
    builder: [
      {
        anchor: "builder-add",
        title: "Add a block",
        body: "Pick a block to add to this page. Every block uses your site's theme, so it always looks right.",
        howTo: PRESETS,
        table: "activate",
        row: 3,
        term: "Add block",
      },
      {
        anchor: "builder-blocks",
        title: "Your blocks",
        body: "Click a block to edit it. Drag its handle, or use Move up and Move down in its menu, to change the order.",
        howTo: PRESETS,
        row: 10,
        term: "Move up",
      },
      {
        anchor: "builder-history",
        title: "History",
        body: "We keep the last 10 published versions of this page. You can restore any of them.",
        howTo: PAGES_HISTORY,
        row: 1,
        term: "History",
      },
      {
        anchor: "builder-publish",
        title: "Publish",
        body: "Your edits save as a draft. Publish puts them live on your site.",
        howTo: PUBLISH,
        row: 4,
        term: "Publish",
      },
    ],
    addons: [
      {
        anchor: "addons-card",
        title: "Add-ons",
        body: "Each card says what an add-on adds to your site and what it costs. Click its name for the details.",
        howTo: ADDONS,
        row: 1,
        term: "card",
      },
      {
        anchor: "addons-add",
        title: "Add to site",
        body: "You confirm first, then it's on your site within seconds. Remove it any time and your content is kept.",
        howTo: ADDONS,
        row: 2,
        term: "Add to site",
      },
    ],
    media: [
      {
        anchor: "media-upload",
        title: "Upload files",
        body: "Add photos, videos or MP3s. Give each photo a short description so everyone can see it.",
        howTo: MEDIA,
        row: 1,
        term: "Upload files",
      },
      {
        anchor: "media-grid",
        title: "Your files",
        body: "Click a file to see its details, where it's used and its description.",
        howTo: MEDIA,
        row: 7,
        term: "Click a photo tile",
      },
      {
        anchor: "media-meter",
        title: "Storage",
        body: "This shows how much of your media storage is used.",
        howTo: MEDIA,
        row: 11,
        term: "meter",
      },
    ],
  });

export function isTourId(v: unknown): v is TourId {
  return typeof v === "string" && (TOUR_IDS as readonly string[]).includes(v);
}

/** Help entry id (resolved, see apps/web/lib/help-index.ts) -> the tour on that screen. */
export const TOUR_FOR_HELP_ENTRY: Readonly<Record<string, TourId>> =
  Object.freeze({
    today: "today",
    pages: "builder",
    "get-add-ons": "addons",
    "media-library": "media",
  });

/**
 * Where "Show the tour" goes from a Help article: the screen, with `tour=<id>` so its
 * TourHost replays the tour. The builder has no single screen (one per page): null.
 */
export const TOUR_SCREEN_HREF: Readonly<Record<TourId, string | null>> =
  Object.freeze({
    today: "/hub/today?tour=today",
    builder: null,
    addons: "/hub/add-ons?tour=addons",
    media: "/hub/website?tab=media&tour=media",
  });

export const TOUR_COPY = {
  skip: "Skip tour",
  back: "Back",
  next: "Next",
  done: "Done",
  showTour: "Show the tour",
  stepOf: (n: number, m: number) => `Step ${n} of ${m}`,
  live: (n: number, m: number, title: string) =>
    `Tour, step ${n} of ${m}: ${title}`,
} as const;

/** The coachmark's view of a tour (no how-to references). */
export function tourSteps(id: TourId): TourStepView[] {
  return TOURS[id].map(({ anchor, title, body }) => ({ anchor, title, body }));
}
