// Build tracker (DASH-31, D312): Received → Site assembled → CDS polishing → Your review → Live,
// derived from the org stage plus P8 assembly status. Pure; no percentage (UI-SPEC § 2).
import type { StageName } from "./items";

export const TRACKER_STEP_IDS = [
  "received",
  "assembled",
  "polishing",
  "review",
  "live",
] as const;

export type TrackerStepId = (typeof TRACKER_STEP_IDS)[number];
export type TrackerStepState = "done" | "current" | "upcoming";
export type AssemblyState = "none" | "running" | "done" | "failed";

export type TrackerStep = {
  id: TrackerStepId;
  label: string;
  state: TrackerStepState;
  /** ISO date the step finished, when known. */
  at?: string;
  /** TRACK-DEFAULT copy for "What CDS is doing now" when the org has no build_note. */
  defaultLine: string;
};

export type TrackerInput = {
  stage: StageName | string | null | undefined;
  paidAt?: string | null;
  assembly: AssemblyState;
  buildStartedAt?: string | null;
  readyForReviewAt?: string | null;
  launchedAt?: string | null;
};

export const TRACKER_LABELS: Readonly<Record<TrackerStepId, string>> =
  Object.freeze({
    received: "Received",
    assembled: "Site assembled",
    polishing: "Support polishing",
    review: "Your review",
    live: "Live",
  });

/** TRACK-DEFAULT (UI-SPEC Copywriting Contract), by step. */
export const TRACK_DEFAULT: Readonly<Record<TrackerStepId, string>> =
  Object.freeze({
    received:
      "We have your answers and your payment. Support starts on your site next.",
    assembled:
      "Your pages are set up from your answers. Support is checking them over.",
    polishing: "Support is refining your pages, photos and wording.",
    review: "Your turn: look over your site.",
    live: "Your site is live.",
  });

const STAGE_RANK: Readonly<Record<string, number>> = Object.freeze({
  "": 0,
  intake: 0,
  fit_review: 1,
  ready_for_build: 2,
  being_built: 3,
  ready_for_review: 4,
  live: 5,
});

function present(v: string | null | undefined): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Each step is done by its own evidence; the first step not done is `current`, the rest
 * `upcoming`. Received: paid or stage ≥ ready_for_build. Assembled: assembly done, or CDS
 * has started building by hand (being_built with buildStartedAt and assembly not running),
 * or stage ≥ ready_for_review. Polishing: stage ≥ ready_for_review. Review and Live: live.
 */
export function deriveTracker(input: TrackerInput): TrackerStep[] {
  const rank = STAGE_RANK[input.stage ?? ""] ?? 0;
  const live = rank >= STAGE_RANK.live!;
  const reviewing = rank >= STAGE_RANK.ready_for_review!;
  const done: Record<TrackerStepId, boolean> = {
    received: present(input.paidAt) || rank >= STAGE_RANK.ready_for_build!,
    assembled:
      input.assembly === "done" ||
      reviewing ||
      (rank >= STAGE_RANK.being_built! &&
        present(input.buildStartedAt) &&
        input.assembly !== "running"),
    polishing: reviewing,
    review: live,
    live,
  };
  const at: Partial<Record<TrackerStepId, string>> = {};
  if (present(input.paidAt)) at.received = input.paidAt;
  if (present(input.readyForReviewAt)) at.polishing = input.readyForReviewAt;
  if (present(input.launchedAt)) {
    at.review = input.launchedAt;
    at.live = input.launchedAt;
  }

  let currentSeen = false;
  return TRACKER_STEP_IDS.map((id) => {
    let state: TrackerStepState;
    if (done[id] && !currentSeen) state = "done";
    else if (!currentSeen) {
      state = "current";
      currentSeen = true;
    } else state = "upcoming";
    const step: TrackerStep = {
      id,
      label: TRACKER_LABELS[id],
      state,
      defaultLine: TRACK_DEFAULT[id],
    };
    if (state === "done" && at[id]) step.at = at[id];
    return step;
  });
}
