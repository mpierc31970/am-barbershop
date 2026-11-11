"use client";
// "Open now" pill island (07-24; CONT-27, D257; UI-SPEC row 366, copy 645, a11y 683).
//
// Computed in the visitor's browser from the embedded hours and the business time zone.
// The first render returns null, equal to the server markup (an empty reserved slot), so
// hydration never mismatches and nothing shifts. After mount it computes the status and
// re-computes every 60 s; the interval is cleared on unmount (T-07-24-06). Plain text, no
// live region ("Open now" is text per UI-SPEC a11y).
import { openStatus, type HoursOpenStatus } from "@cds/core/content";
import type { WeeklyHours } from "@cds/core/intake";
import { useEffect, useState } from "react";
import { BODY_CLASS } from "../types";

export interface OpenNowProps {
  hours: WeeklyHours;
  timeZone: string;
}

export const OPEN_NOW_TICK_MS = 60_000;

export function OpenNow({ hours, timeZone }: OpenNowProps) {
  const [status, setStatus] = useState<HoursOpenStatus | null>(null);

  useEffect(() => {
    const tick = () => setStatus(openStatus(hours, timeZone, new Date()));
    tick();
    const id = setInterval(tick, OPEN_NOW_TICK_MS);
    return () => clearInterval(id);
  }, [hours, timeZone]);

  if (!status) return null;
  return (
    <p
      className={`${BODY_CLASS} inline-flex items-center rounded-site-button border border-site-text px-3 py-1 text-site-text`}
    >
      {status.label}
    </p>
  );
}
