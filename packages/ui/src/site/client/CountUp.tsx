"use client";
// Stats count-up island (07-21; CONT-27, D-UI-P7-27; 07-UI-SPEC "Stats", "Motion contract").
//
// The first render prints the final value, so it equals the server markup (no flash, no
// layout shift: an invisible copy of the final value reserves the width in the same grid
// cell). The first IntersectionObserver callback decides (plan decision 9): out of view ->
// silently show the zero form and animate when at least half is in view; already in view ->
// animate from zero at once. 1,200 ms ease-out cubic via requestAnimationFrame, once. Never
// under prefers-reduced-motion, never without IntersectionObserver. Both spans are
// aria-hidden: the stat's sr-only text carries the accessible name. Server components
// import this file directly (Countdown pattern); it is not in the client barrel.
import { useEffect, useRef, useState } from "react";
import { formatStatsNumber, statsNumberParts } from "../blocks/stats-number";

export interface CountUpProps {
  /** The typed stat value ("1,200"); the last frame prints exactly this. */
  value: string;
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const DURATION_MS = 1200;
const THRESHOLD = 0.5;

export function CountUp({ value }: CountUpProps) {
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    const parts = statsNumberParts(value);
    if (!el || !parts) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED).matches
    ) {
      return;
    }
    if (typeof window.IntersectionObserver !== "function") return;

    let raf = 0;
    let first = true;
    let ran = false;
    const zero = formatStatsNumber(0, parts);

    const run = () => {
      ran = true;
      observer.disconnect();
      let start: number | null = null;
      const frame = (ts: number) => {
        if (start === null) start = ts;
        const t = Math.min(1, (ts - start) / DURATION_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        setShown(
          t >= 1 ? value : formatStatsNumber(parts.target * eased, parts),
        );
        if (t < 1) raf = window.requestAnimationFrame(frame);
      };
      setShown(zero);
      raf = window.requestAnimationFrame(frame);
    };

    const observer = new window.IntersectionObserver(
      (entries) => {
        if (ran) return;
        const entry = entries[entries.length - 1];
        const visible =
          !!entry &&
          entry.isIntersecting &&
          entry.intersectionRatio >= THRESHOLD;
        if (first) {
          first = false;
          if (!visible) {
            setShown(zero);
            return;
          }
        }
        if (visible) run();
      },
      { threshold: THRESHOLD },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [value]);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="inline-grid tabular-nums"
      data-cds-count-up=""
    >
      <span className="invisible col-start-1 row-start-1">{value}</span>
      <span className="col-start-1 row-start-1">{shown}</span>
    </span>
  );
}
