"use client";
// Tour replay registry (11-48; DASH-17). The hub's HelpDrawerHost provides it; each screen's
// TourHost registers its tour while mounted, so the help drawer's "Show the tour" appears
// only on the screen that has that tour and replays it in place.
import { createContext } from "react";
import type { TourId } from "./tours";

export type TourReplay = {
  /** Registers a tour's start function; returns the unregister function. */
  register: (id: TourId, start: () => void) => () => void;
};

export const TourReplayContext = createContext<TourReplay | null>(null);
