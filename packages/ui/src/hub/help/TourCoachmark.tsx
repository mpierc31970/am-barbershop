"use client";
// TourCoachmark (11-48; DASH-17, D208; 11-UI-SPEC "First-use tours" lines 612-630,
// accessibility + motion contracts, D-UI-P11-17). An in-house, non-modal coachmark:
// - `role="dialog"` `aria-modal="false"`, labelled by the step title, described by
//   "Step n of m"; a polite live region announces "Tour, step n of m: {title}".
// - Points at `[data-tour="<anchor>"]`. Steps whose anchor is missing or hidden (no
//   offsetParent and not position:fixed, e.g. a desktop-only pane on a phone) are dropped
//   when the tour starts; with none left nothing renders (the host never starts it).
// - 320px panel, --hub-surface, 1px border, 8px radius, the P3 lift shadow. Placed below the
//   anchor, else above, and centred at the bottom on phones (< 640px). The anchor gets a 2px
//   accent ring at 4px offset (150ms colour fade, none under reduced motion) and is scrolled
//   to the centre (instant under reduced motion).
// - Focus moves to the title on every step; Tab cycles inside; Esc = Skip tour; a press
//   anywhere outside the coachmark ends the tour as skipped (the page stays usable). On the
//   way out focus returns to the last anchor shown.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../Button";
import { useReducedMotion } from "../motion";
import { TOUR_COPY, type TourStepView } from "./tours";

export interface TourCoachmarkProps {
  steps: readonly TourStepView[];
  onSkip: () => void;
  onDone: () => void;
}

const PANEL_W = 320;
const GAP = 12;
const EDGE = 16;
const PHONE = 640;

/** The element for an anchor id, or null. */
export function tourAnchor(
  anchor: string,
  root: ParentNode = document,
): HTMLElement | null {
  if (!/^[a-z0-9-]{1,60}$/.test(anchor)) return null;
  const all = Array.from(
    root.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`),
  );
  return all.find(isShown) ?? null;
}

/** Laid out and not hidden: hidden panes have no offsetParent (fixed elements excepted). */
export function isShown(el: HTMLElement): boolean {
  if (el.closest("[hidden],[aria-hidden='true'],[inert]")) return false;
  if (el.offsetParent !== null) return true;
  return getComputedStyle(el).position === "fixed";
}

/** The steps whose anchor is on screen right now, in order. */
export function visibleTourSteps(
  steps: readonly TourStepView[],
  root: ParentNode = document,
): TourStepView[] {
  return steps.filter((s) => tourAnchor(s.anchor, root) !== null);
}

type Place = { top: number; left: number; phone: boolean };

function placeBeside(anchor: HTMLElement, panelH: number): Place {
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;
  if (vw < PHONE) return { top: 0, left: 0, phone: true };
  const r = anchor.getBoundingClientRect();
  const width = Math.min(PANEL_W, vw - EDGE * 2);
  let left = Math.min(Math.max(r.left, EDGE), vw - width - EDGE);
  if (!Number.isFinite(left)) left = EDGE;
  const below = r.bottom + GAP;
  const above = r.top - GAP - panelH;
  let top: number;
  if (below + panelH <= vh - EDGE) top = below;
  else if (above >= EDGE) top = above;
  else top = Math.max(EDGE, vh - panelH - EDGE);
  return { top, left, phone: false };
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusAnchor(el: HTMLElement | null): void {
  if (!el || !el.isConnected) return;
  const target = el.matches(FOCUSABLE)
    ? el
    : el.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus({ preventScroll: true });
}

type Ring = {
  el: HTMLElement;
  outline: string;
  offset: string;
  transition: string;
};

export function TourCoachmark({ steps, onSkip, onDone }: TourCoachmarkProps) {
  const reduced = useReducedMotion();
  // Fixed when the tour starts: a step that is hidden now is skipped for this run.
  const [shown] = useState<TourStepView[]>(() =>
    typeof document === "undefined" ? [] : visibleTourSteps(steps),
  );
  const [index, setIndex] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const ringRef = useRef<Ring | null>(null);
  const endedRef = useRef(false);
  const titleId = useId();
  const stepId = useId();

  const step = shown[index] ?? null;
  const total = shown.length;
  const last = index === total - 1;

  const clearRing = useCallback(() => {
    const ring = ringRef.current;
    if (!ring) return;
    ring.el.style.outline = ring.outline;
    ring.el.style.outlineOffset = ring.offset;
    ring.el.style.transition = ring.transition;
    ringRef.current = null;
  }, []);

  const end = useCallback(
    (how: "skip" | "done") => {
      if (endedRef.current) return;
      endedRef.current = true;
      const anchor = anchorRef.current;
      clearRing();
      focusAnchor(anchor);
      if (how === "done") onDone();
      else onSkip();
    },
    [clearRing, onDone, onSkip],
  );

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const h = panelRef.current?.offsetHeight || 200;
    setPlace(placeBeside(anchor, h));
  }, []);

  // Each step: find the anchor, ring it, scroll it into view, place the panel, focus the title.
  useLayoutEffect(() => {
    if (!step) return;
    clearRing();
    const anchor = tourAnchor(step.anchor);
    anchorRef.current = anchor;
    if (anchor) {
      ringRef.current = {
        el: anchor,
        outline: anchor.style.outline,
        offset: anchor.style.outlineOffset,
        transition: anchor.style.transition,
      };
      if (!reduced) anchor.style.transition = "outline-color 150ms ease-out";
      anchor.style.outline = "2px solid var(--hub-accent)";
      anchor.style.outlineOffset = "4px";
      if (typeof anchor.scrollIntoView === "function") {
        anchor.scrollIntoView({
          block: "center",
          behavior: reduced ? "instant" : "smooth",
        });
      }
    }
    reposition();
    titleRef.current?.focus({ preventScroll: true });
  }, [step, reduced, clearRing, reposition]);

  // Keep the panel beside the anchor while the page scrolls or resizes.
  useEffect(() => {
    if (!step) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [step, reposition]);

  // Esc skips (unless a modal dialog is open on top); a press outside ends it as skipped.
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (
        document.querySelector(
          "dialog[open][aria-modal='true'],[role='dialog'][aria-modal='true']",
        )
      )
        return;
      e.preventDefault();
      end("skip");
    };
    const onPress = (e: PointerEvent | MouseEvent) => {
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && panel.contains(e.target)) return;
      end("skip");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress, true);
    };
  }, [step, end]);

  useEffect(() => clearRing, [clearRing]);

  if (!step || typeof document === "undefined") return null;

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!;
    const lastItem = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === titleRef.current)) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && active === lastItem) {
      e.preventDefault();
      first.focus();
    }
  };

  const phone = place?.phone ?? false;
  const style: CSSProperties = phone
    ? { left: EDGE, right: EDGE, bottom: EDGE }
    : place
      ? {
          top: place.top,
          left: place.left,
          width: PANEL_W,
          maxWidth: `calc(100vw - ${EDGE * 2}px)`,
        }
      : { visibility: "hidden", top: 0, left: 0, width: PANEL_W };

  return createPortal(
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={stepId}
        data-tour-coachmark=""
        onKeyDown={onPanelKey}
        style={style}
        className={
          "fixed z-50 flex flex-col gap-2 rounded-lg border border-hub-border bg-hub-surface p-4 " +
          "font-hub text-hub-ink shadow-[0_8px_24px_rgb(0_0_0/0.12)]"
        }
      >
        <p
          id={stepId}
          className="text-sm font-semibold text-hub-ink-muted tabular-nums"
        >
          {TOUR_COPY.stepOf(index + 1, total)}
        </p>
        <h2
          ref={titleRef}
          id={titleId}
          tabIndex={-1}
          className="text-lg leading-tight font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
        >
          {step.title}
        </h2>
        <p className="text-base">{step.body}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => end("skip")}>
            {TOUR_COPY.skip}
          </Button>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                {TOUR_COPY.back}
              </Button>
            ) : null}
            {last ? (
              <Button variant="primary" size="sm" onClick={() => end("done")}>
                {TOUR_COPY.done}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
              >
                {TOUR_COPY.next}
              </Button>
            )}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite" data-tour-live="">
        {TOUR_COPY.live(index + 1, total, step.title)}
      </p>
    </>,
    document.body,
  );
}
