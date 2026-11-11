"use client";
// Slider carousel island (07-20; CONT-23, D229; 07-UI-SPEC row "Slider" line 358, slider
// controls colour roles line 175, a11y contract line 677, motion contract lines 692-693,
// <768px rule line 699, D-UI-P7-25 controls bar under the slides).
//
// Generic: 07-22's gallery slider mode reuses it (one photo per slide node).
//
// Decisions (07-20-PLAN):
// 1. Slides arrive as server-rendered nodes; this island owns state and attributes in
//    React and never queries server markup (except to pause videos in its own slides).
// 3. `inert` only after mount: the first render equals the SSR markup, so the no-JS view
//    stays keyboard-reachable.
// 4. Direction is reading order: ltr = next enters from the right; rtl mirrors it (and
//    the arrows/dots group runs right to left); ttb = next enters from below at >=768px and
//    from the right below (CSS breakpoint classes, no matchMedia). Wrap-around still
//    enters from the reading-order side (the step follows the visitor's intent).
// 5. Pause first: the bar is Pause/Play · Previous · dots · Next (APG wins over row 358).
// 6. Never control-less: arrows and dots both off still shows Previous and Next.
// 7. Reduced motion: never auto-plays (the button reads "Play slides"; pressing it opts
//    in) and slides change with no animation.
// APG carousel: region + aria-roledescription, slides are labelled groups, a polite live
// region speaks only when not auto-playing, and rotation stops for the page view once the
// visitor uses any control or swipes. Hand-written (UI-SPEC: no new dependency). Theme
// token classes only. Never imports the sanitizer.
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SliderDirection, SliderTransition } from "@cds/core/content";
import { stopHiddenMedia } from "./popup-media";

export interface SliderControllerProps {
  slides: readonly { id: string; node: ReactNode }[];
  /** Id of the visible block heading; otherwise the region is named "Slides". */
  labelledBy?: string;
  direction: SliderDirection;
  arrows: boolean;
  dots: boolean;
  autoplay: boolean;
  intervalMs: number;
  transition: SliderTransition;
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const DURATION_MS = 300;
const SWIPE_MIN_PX = 40;

/** Where a move is in its animation: entering slide placed, then running, then done. */
type Phase = "idle" | "start" | "run";

const EASE = "ease-[cubic-bezier(0.16,1,0.3,1)]";
const SLIDE_MOTION = `transition-transform duration-300 ${EASE}`;
const FADE_MOTION = `transition-opacity duration-300 ${EASE}`;

/** Offset classes for the positive (+) and negative (-) side of the reading order. */
const SIDE: Record<"x" | "ttb", Record<"+" | "-", string>> = {
  x: { "+": "translate-x-full", "-": "-translate-x-full" },
  ttb: {
    "+": "translate-x-full md:translate-x-0 md:translate-y-full",
    "-": "-translate-x-full md:translate-x-0 md:-translate-y-full",
  },
};

const CONTROL =
  "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-site-button " +
  "border border-site-text bg-transparent text-site-text transition-colors duration-150 " +
  "hover:bg-site-surface-raised";

export function SliderController({
  slides,
  labelledBy,
  direction,
  arrows,
  dots,
  autoplay,
  intervalMs,
  transition,
}: SliderControllerProps) {
  const count = slides.length;
  const [active, setActive] = useState(0);
  const [from, setFrom] = useState<number | null>(null);
  const [step, setStep] = useState<1 | -1>(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [playing, setPlaying] = useState(autoplay);
  const [stopped, setStopped] = useState(false);
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [userMoved, setUserMoved] = useState(false);

  const regionRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pauseRef = useRef<HTMLButtonElement | null>(null);
  const reducedRef = useRef(false);

  const running =
    mounted &&
    autoplay &&
    playing &&
    !stopped &&
    !hover &&
    !focusWithin &&
    visible &&
    count > 1;

  // Mount: read reduced motion, then mark mounted (deferred: no sync setState in effects).
  useEffect(() => {
    const isReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED).matches;
    reducedRef.current = isReduced;
    const t = setTimeout(() => {
      setReduced(isReduced);
      if (isReduced) setPlaying(false);
      setMounted(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Mirrors `active` for event handlers and timers (updated only inside go()).
  const activeRef = useRef(0);

  const go = useCallback(
    (target: number, dir: 1 | -1, byUser: boolean) => {
      if (count < 2) return;
      const next = ((target % count) + count) % count;
      if (byUser) {
        setStopped(true);
        setUserMoved(true);
      }
      const prev = activeRef.current;
      if (prev === next) return;
      activeRef.current = next;
      setActive(next);
      setStep(dir);
      if (reducedRef.current) {
        setFrom(null);
        setPhase("idle");
      } else {
        setFrom(prev);
        setPhase("start");
      }
    },
    [count],
  );

  // Two-phase animation: the entering slide is placed at its start side, then on the next
  // frame both slides move; the leaving slide is released after the 300ms transition.
  useEffect(() => {
    if (phase === "idle") return;
    if (phase === "start") {
      const raf =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(() =>
              window.requestAnimationFrame(() => setPhase("run")),
            )
          : null;
      const fallback =
        raf === null ? setTimeout(() => setPhase("run"), 16) : null;
      return () => {
        if (raf !== null) window.cancelAnimationFrame(raf);
        if (fallback !== null) clearTimeout(fallback);
      };
    }
    const done = setTimeout(() => {
      setFrom(null);
      setPhase("idle");
    }, DURATION_MS + 20);
    return () => clearTimeout(done);
  }, [phase, active]);

  // Auto-play: one timer at a time, only while every pause condition is clear.
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => go(activeRef.current + 1, 1, false), intervalMs);
    return () => clearTimeout(t);
  }, [running, active, intervalMs, go]);

  // Hover, focus within, swipe and page visibility (native listeners).
  useEffect(() => {
    const region = regionRef.current;
    const viewport = viewportRef.current;
    if (!region || count < 2) return;
    const onEnter = () => setHover(true);
    const onLeave = () => setHover(false);
    const onFocusIn = (e: Event) => {
      // Focus on the Pause/Play button itself never pauses: pressing Play must play.
      setFocusWithin(e.target !== pauseRef.current);
    };
    const onFocusOut = (e: Event) => {
      const next = (e as FocusEvent).relatedTarget;
      if (
        !(next instanceof Node) ||
        !region.contains(next) ||
        next === pauseRef.current
      ) {
        setFocusWithin(false);
      }
    };
    let start: { x: number; y: number } | null = null;
    const onDown = (e: Event) => {
      const p = e as PointerEvent;
      start = p.pointerType === "touch" ? { x: p.clientX, y: p.clientY } : null;
    };
    const onUp = (e: Event) => {
      const p = e as PointerEvent;
      if (!start || p.pointerType !== "touch") return;
      const dx = p.clientX - start.x;
      const dy = p.clientY - start.y;
      start = null;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
      const forward = direction === "rtl" ? dx > 0 : dx < 0;
      const cur = activeRef.current;
      if (forward) go(cur + 1, 1, true);
      else go(cur - 1, -1, true);
    };
    const onVisibility = () =>
      setVisible(document.visibilityState !== "hidden");
    region.addEventListener("pointerenter", onEnter);
    region.addEventListener("pointerleave", onLeave);
    region.addEventListener("focusin", onFocusIn);
    region.addEventListener("focusout", onFocusOut);
    viewport?.addEventListener("pointerdown", onDown);
    viewport?.addEventListener("pointerup", onUp);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      region.removeEventListener("pointerenter", onEnter);
      region.removeEventListener("pointerleave", onLeave);
      region.removeEventListener("focusin", onFocusIn);
      region.removeEventListener("focusout", onFocusOut);
      viewport?.removeEventListener("pointerdown", onDown);
      viewport?.removeEventListener("pointerup", onUp);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [count, direction, go]);

  // Media in a slide that is no longer active stops playing: video, audio and loaded
  // provider frames (WR-D03).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.querySelectorAll<HTMLElement>("[data-slide]").forEach((el, i) => {
      if (i === active) return;
      stopHiddenMedia(el);
    });
  }, [active]);

  if (count === 0) return null;
  if (count === 1) return <div>{slides[0].node}</div>;

  // + = the side the next slide enters from in reading order.
  const sign = step * (direction === "rtl" ? -1 : 1);
  const enterSide: "+" | "-" = sign > 0 ? "+" : "-";
  const exitSide: "+" | "-" = sign > 0 ? "-" : "+";
  const axis = direction === "ttb" ? SIDE.ttb : SIDE.x;
  const animate = !reduced && phase !== "idle";

  const slideClass = (i: number): string => {
    const base = "min-w-0 [grid-area:1/1] motion-reduce:transition-none";
    const isActive = i === active;
    const isLeaving = from !== null && i === from && !isActive;
    if (!isActive && !isLeaving) return `${base} invisible`;
    if (!animate) return base;
    if (transition === "fade") {
      if (isActive) {
        return phase === "start"
          ? `${base} opacity-0`
          : `${base} ${FADE_MOTION} opacity-100`;
      }
      return phase === "start"
        ? `${base} opacity-100`
        : `${base} ${FADE_MOTION} opacity-0`;
    }
    if (isActive) {
      return phase === "start"
        ? `${base} ${axis[enterSide]}`
        : `${base} ${SLIDE_MOTION}`;
    }
    return phase === "start"
      ? base
      : `${base} ${SLIDE_MOTION} ${axis[exitSide]}`;
  };

  const stateOf = (i: number): string =>
    i === active ? "active" : from === i ? "leaving" : "waiting";

  const showArrows = arrows || !dots;
  const showPlay = playing && !stopped;

  return (
    <div
      ref={regionRef}
      data-cds-slider=""
      role="region"
      aria-roledescription="carousel"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : "Slides"}
    >
      <div
        ref={viewportRef}
        data-slider-viewport=""
        className="grid touch-pan-y overflow-hidden"
      >
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            data-slide=""
            data-state={stateOf(i)}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            inert={mounted && i !== active ? true : undefined}
            className={slideClass(i)}
          >
            {slide.node}
          </div>
        ))}
      </div>
      <div
        data-slider-controls=""
        className="mt-6 flex items-center justify-center gap-2 text-[length:var(--site-text-body)]"
      >
        {autoplay ? (
          <button
            ref={pauseRef}
            type="button"
            className={CONTROL}
            aria-label={showPlay ? "Pause slides" : "Play slides"}
            onClick={() => {
              if (showPlay) {
                setPlaying(false);
              } else {
                setPlaying(true);
                setStopped(false);
              }
            }}
          >
            {showPlay ? (
              <Pause aria-hidden="true" className="size-5" />
            ) : (
              <Play aria-hidden="true" className="size-5" />
            )}
          </button>
        ) : null}
        <div
          data-slider-nav=""
          className={`flex items-center gap-2 ${direction === "rtl" ? "flex-row-reverse" : ""}`}
        >
          {showArrows ? (
            <button
              type="button"
              className={CONTROL}
              aria-label="Previous slide"
              onClick={() => go(active - 1, -1, true)}
            >
              {direction === "rtl" ? (
                <ChevronRight aria-hidden="true" className="size-5" />
              ) : (
                <ChevronLeft aria-hidden="true" className="size-5" />
              )}
            </button>
          ) : null}
          {dots ? (
            <div
              className={`flex items-center ${direction === "rtl" ? "flex-row-reverse" : ""}`}
            >
              {slides.map((slide, i) => (
                <button
                  key={slide.id}
                  type="button"
                  className="inline-flex size-11 cursor-pointer items-center justify-center bg-transparent"
                  aria-label={`Go to slide ${i + 1} of ${count}`}
                  aria-current={i === active ? "true" : undefined}
                  onClick={() => go(i, i >= active ? 1 : -1, true)}
                >
                  <span
                    aria-hidden="true"
                    className={
                      i === active
                        ? "block size-3 rounded-full bg-site-text"
                        : "block size-3 rounded-full ring-1 ring-site-text-muted ring-inset"
                    }
                  />
                </button>
              ))}
            </div>
          ) : null}
          {showArrows ? (
            <button
              type="button"
              className={CONTROL}
              aria-label="Next slide"
              onClick={() => go(active + 1, 1, true)}
            >
              {direction === "rtl" ? (
                <ChevronLeft aria-hidden="true" className="size-5" />
              ) : (
                <ChevronRight aria-hidden="true" className="size-5" />
              )}
            </button>
          ) : null}
        </div>
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {userMoved && !running ? `Slide ${active + 1} of ${count}` : ""}
      </div>
    </div>
  );
}
