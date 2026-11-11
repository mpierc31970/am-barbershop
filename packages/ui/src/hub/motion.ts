"use client";
// Shared drag motion helpers (03-UI-SPEC / 05-UI-SPEC "Motion contract": drag keeps
// tracking, reduced motion drops the scale). Moved here from builder/ItemListEditor so hub
// lists (RecordList) use them without pulling the rich-text editor into their bundle;
// ItemListEditor re-exports them unchanged.
import { useSyncExternalStore } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(REDUCED).matches
        : false,
    () => false,
  );
}

/** Lifted-item look: shadow + 1.02 scale; scale dropped under reduced motion. */
export function liftClasses(dragging: boolean): string {
  return dragging
    ? "relative z-10 shadow-[0_8px_24px_rgb(0_0_0/0.12)] scale-[1.02] motion-reduce:scale-100"
    : "";
}
