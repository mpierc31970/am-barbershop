"use client";
// First-use tour host (11-48; DASH-17, D208; 11-UI-SPEC "First-use tours" lines 612-630;
// D-UI-P11-17; T-11-48-01). Mounted by a screen through TourSlot (tour-slot.tsx), which
// leaves it out for impersonating staff. It:
// - starts the tour once the screen has rendered (streamed sections included) when
//   `autoStart` (this person hasn't seen it) and nothing else is open (no modal dialog);
// - replays it on `?tour=<id>` (Help article "Show the tour"), then drops the param;
// - registers with TourReplayContext so the help drawer's "Show the tour" replays it here;
// - on Done or Skip writes the seen flag (markTourSeenAction; a no-op for staff).
// A tour whose anchors are all missing or hidden never starts and is not marked seen.
import {
  TourCoachmark,
  TourReplayContext,
  tourSteps,
  visibleTourSteps,
  type TourId,
} from "@cds/ui/hub/help";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { markTourSeenAction } from "../../actions/tours";

/** How often and how long to wait for the screen to settle before starting. */
export const TOUR_POLL_MS = 300;
export const TOUR_WAIT_MS = 4000;

const MODAL_OPEN =
  "dialog[open][aria-modal='true'],[role='dialog'][aria-modal='true'],dialog[open]:modal";

function modalOpen(): boolean {
  try {
    return document.querySelector(MODAL_OPEN) !== null;
  } catch {
    // `:modal` is not supported everywhere; fall back to the attribute check.
    return (
      document.querySelector(
        "dialog[open][aria-modal='true'],[role='dialog'][aria-modal='true']",
      ) !== null
    );
  }
}

/** Reads and removes `tour=<id>` from the current URL (no navigation). */
function takeTourParam(id: TourId): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("tour") !== id) return false;
  params.delete("tour");
  const q = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`,
  );
  return true;
}

export interface TourHostProps {
  tourId: TourId;
  /** True when this person hasn't seen this tour yet. */
  autoStart: boolean;
}

export function TourHost({ tourId, autoStart }: TourHostProps) {
  const steps = useMemo(() => tourSteps(tourId), [tourId]);
  const replay = useContext(TourReplayContext);
  // Bumped per run so the coachmark remounts and re-reads the visible anchors.
  const [run, setRun] = useState(0);
  const [running, setRunning] = useState(false);
  const autoRef = useRef(autoStart);

  const start = useCallback(() => {
    if (visibleTourSteps(steps).length === 0) return;
    setRun((n) => n + 1);
    setRunning(true);
  }, [steps]);

  // First visit (or ?tour=): wait for the screen to settle, then start.
  // Read once: a dev double-run of the effect must not lose the param.
  const forcedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (forcedRef.current === null) forcedRef.current = takeTourParam(tourId);
    if (!forcedRef.current && !autoRef.current) return;
    let waited = 0;
    const timer = window.setInterval(() => {
      waited += TOUR_POLL_MS;
      const shown = visibleTourSteps(steps).length;
      const ready =
        !modalOpen() &&
        (shown === steps.length || (waited >= TOUR_WAIT_MS && shown > 0));
      if (ready) {
        window.clearInterval(timer);
        start();
      } else if (waited >= TOUR_WAIT_MS * 2) {
        window.clearInterval(timer);
      }
    }, TOUR_POLL_MS);
    return () => window.clearInterval(timer);
  }, [tourId, steps, start]);

  useEffect(() => {
    if (!replay) return;
    return replay.register(tourId, start);
  }, [replay, tourId, start]);

  const finish = useCallback(() => {
    setRunning(false);
    autoRef.current = false;
    forcedRef.current = false;
    void markTourSeenAction(tourId).catch(() => undefined);
  }, [tourId]);

  if (!running) return null;
  return (
    <TourCoachmark key={run} steps={steps} onSkip={finish} onDone={finish} />
  );
}
