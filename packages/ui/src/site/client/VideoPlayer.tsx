"use client";
// MP4 video island (07-23; CONT-17, CONT-21, WCAG 2.2.2; 07-UI-SPEC "Column items", motion and
// accessibility; 07-23 choices 4-7).
//
// Progressive enhancement: the first render equals the server markup, a plain
// <video controls preload="none" playsinline poster> that works without JS. After mount a
// 64 px play button overlays the frame (absolute, so nothing shifts); any `play` event (the
// button, a pop-up opening, autoplay) hides it and applies the item's `controls`.
// - Autoplay is muted only, starts when at least half the video is in view, never under
//   reduced motion and never inside [hidden], [inert] or [aria-hidden="true"] (a slide the
//   slider paused). Leaving view pauses it. A visitor's own pause is respected.
// - Controls off: once the video has started, a visible Pause / Play toggle (WCAG 2.2.2).
// - Every video carries data-cds-popup-play: popup-media.ts plays it muted when its pop-up
//   opens and pauses it on close; outside a pop-up the attribute is inert (choice 4).
// Props are plain strings and booleans only. Every play() rejection is swallowed.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

export interface VideoPlayerProps {
  src: string;
  poster: string;
  /** Our .vtt URL, or "". */
  captions: string;
  crossOrigin?: "anonymous";
  mime: string;
  title: string;
  /** CSS aspect-ratio value, e.g. "16 / 9". */
  aspect: string;
  controls: boolean;
  loop: boolean;
  autoplay: boolean;
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const HIDDEN_ANCESTOR = "[hidden],[inert],[aria-hidden='true']";

const PLAY_BUTTON =
  "inline-flex size-16 items-center justify-center rounded-full bg-site-primary " +
  "text-site-primary-contrast cursor-pointer shadow-site-overlay " +
  "hover:bg-[color-mix(in_oklch,var(--site-primary)_88%,var(--site-text))]";

const TOGGLE =
  "absolute bottom-3 left-3 inline-flex size-11 items-center justify-center rounded-full " +
  "border border-site-border bg-site-surface text-site-text cursor-pointer shadow-site-overlay";

function safePlay(video: HTMLVideoElement): void {
  try {
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    // A browser that throws instead of rejecting.
  }
}

function safePause(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    // Best effort.
  }
}

export function VideoPlayer({
  src,
  poster,
  captions,
  crossOrigin,
  mime,
  title,
  aspect,
  controls,
  loop,
  autoplay,
}: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const userPaused = useRef(false);
  const [enhanced, setEnhanced] = useState(false);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    // Deferred so the first client render equals the server markup.
    const t = setTimeout(() => setEnhanced(true), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const onPlay = () => {
      setStarted(true);
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!autoplay || !video || typeof IntersectionObserver !== "function") {
      return;
    }
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED).matches;
    if (reduced) return;
    let inView = false;
    const tryPlay = () => {
      if (!inView || userPaused.current) return;
      if (video.closest(HIDDEN_ANCESTOR)) return;
      video.muted = true;
      video.playsInline = true;
      safePlay(video);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          inView = entry.intersectionRatio >= 0.5;
          if (inView) tryPlay();
          else safePause(video);
        }
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(video);
    // A slide that becomes active drops `inert` without changing what is in view, so no
    // intersection callback fires; re-check when a slide's hidden state changes (WR-D04).
    const slide = video.closest("[data-slide]");
    const mutations =
      slide && typeof MutationObserver === "function"
        ? new MutationObserver(tryPlay)
        : null;
    mutations?.observe(slide!, {
      attributes: true,
      attributeFilter: ["inert", "hidden", "aria-hidden"],
    });
    return () => {
      observer.disconnect();
      mutations?.disconnect();
    };
  }, [autoplay]);

  const start = useCallback(() => {
    const video = ref.current;
    if (!video) return;
    userPaused.current = false;
    setStarted(true);
    safePlay(video);
  }, []);

  const toggle = useCallback(() => {
    const video = ref.current;
    if (!video) return;
    if (playing) {
      userPaused.current = true;
      setPlaying(false);
      safePause(video);
    } else {
      userPaused.current = false;
      safePlay(video);
      setPlaying(true);
    }
  }, [playing]);

  const showControls = !enhanced ? true : started ? controls : false;
  // Any started video without native controls gets the toggle (CR-D01, WCAG 2.2.2): a
  // click-to-play video, or one a pop-up started, must be pausable too.
  const showToggle = enhanced && started && !controls;

  return (
    <div
      className="relative overflow-hidden rounded-site-media bg-site-surface-raised"
      style={{ aspectRatio: aspect }}
    >
      <video
        ref={ref}
        {...(poster ? { poster } : {})}
        preload="none"
        playsInline
        controls={showControls}
        loop={loop}
        muted={autoplay}
        aria-label={title}
        data-cds-popup-play=""
        {...(crossOrigin ? { crossOrigin } : {})}
        className="h-full w-full object-cover"
      >
        {captions ? (
          <track kind="captions" src={captions} label="Captions" default />
        ) : null}
        <source src={src} type={mime} />
      </video>
      {enhanced && !started ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            className={PLAY_BUTTON}
            aria-label={`Play video: ${title}`}
            onClick={start}
          >
            <Play size={24} strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}
      {showToggle ? (
        <button
          type="button"
          className={TOGGLE}
          aria-label={playing ? "Pause video" : "Play video"}
          onClick={toggle}
        >
          {playing ? (
            <Pause size={20} strokeWidth={2} aria-hidden />
          ) : (
            <Play size={20} strokeWidth={2} aria-hidden />
          )}
        </button>
      ) : null}
    </div>
  );
}
