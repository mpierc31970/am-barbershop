"use client";
// A&M first-visit intro: a black overlay where the logo fades in, then a red and a blue neon
// octagon "turn on" around it (flicker, then a steady glow with a slow hum). Decoration only:
// the page renders underneath as normal, the overlay mounts after hydration (never SSR, so it
// gates nothing and shifts nothing), and its logo is drawn smaller than the hero image so it
// never becomes the LCP element.
//
// Shown once: the seen flag is written to localStorage the moment it shows. If storage
// throws, a module flag still limits it to once per page load. Closes after 30 s, or at once
// on any pointer press or key; the Skip button is the one focusable, announced control, and
// focus goes back where it was. Reduced motion: no flicker or hum, a static glow for 2 s.
// Styles: am-barber.css (.am-intro).
import { useEffect, useRef, useState } from "react";

const SEEN_KEY = "am-intro-seen";
const HOLD_MS = 30_000;
const REDUCED_HOLD_MS = 2_000;
const FADE_MS = 400;

let shownThisLoad = false;

// Regular octagon points on a 200 x 200 box, radius r, flat top.
function octagon(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ((22.5 + i * 45) * Math.PI) / 180;
    pts.push(
      `${(100 + r * Math.cos(a)).toFixed(2)},${(100 + r * Math.sin(a)).toFixed(2)}`,
    );
  }
  return pts.join(" ");
}
const RED = octagon(96);
const BLUE = octagon(86);

type Phase = "off" | "on" | "leaving";

export function AmIntro() {
  const [phase, setPhase] = useState<Phase>("off");
  const skip = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (shownThisLoad) return;
    shownThisLoad = true;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
      if (!seen) window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Storage blocked: show once for this page load.
    }
    if (seen) return;
    const active = document.activeElement;
    returnTo.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    setPhase("on");
  }, []);

  useEffect(() => {
    if (phase !== "on") return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const close = () => setPhase("leaving");
    const timer = window.setTimeout(close, reduced ? REDUCED_HOLD_MS : HOLD_MS);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    skip.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => {
      setPhase("off");
      returnTo.current?.focus({ preventScroll: true });
    }, FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "off") return null;
  return (
    <div className="am-intro" data-leaving={phase === "leaving" || undefined}>
      <div className="am-intro__stage" aria-hidden="true">
        <svg className="am-intro__tubes" viewBox="0 0 200 200">
          <polygon
            className="am-intro__tube am-intro__tube--red"
            points={RED}
          />
          <polygon
            className="am-intro__tube am-intro__tube--blue"
            points={BLUE}
          />
        </svg>
        {/* eslint-disable-next-line @next/next/no-img-element -- static public asset, decoration */}
        <img
          className="am-intro__logo"
          src="/am-barber/logo-transparent.png"
          alt=""
          width={474}
          height={474}
          decoding="async"
        />
      </div>
      <button
        ref={skip}
        type="button"
        className="am-intro__skip"
        onClick={() => setPhase("leaving")}
      >
        Skip intro
      </button>
    </div>
  );
}
