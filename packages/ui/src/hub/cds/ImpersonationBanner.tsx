"use client";
// ImpersonationBanner (13-26 choice 3; STAFF-06, D10, D98, D-UI-P13-12; 13-UI-SPEC
// "Impersonation" lines 806-833, copy BANNER, a11y line 1105). A full-width CDS-identity strip
// above the hub top bar on every hub screen while CDS staff view a site: "Viewing {business}
// as CDS staff · as {admin} · {reason} · {N} min left" and End. Sticky at the top (40px) so it
// is never scrolled away; first in tab order (the skip link follows it). The minutes tick
// every 30 s on the client; at 5 minutes the time turns bold and one polite live message
// is announced. End is a form posting the caller's server action (endAction).
// CDS identity allowlist entry #8 (apps/web/test/neutral-chrome.test.tsx).
import { fillCopy, P13_COPY } from "@cds/core/staff";
import { Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buttonClasses } from "../Button";
import { CdsMark } from "./CdsMark";
import { CdsSurface } from "./CdsSurface";

/** Banner words that are not copy IDs (UI-SPEC lines 815-822, verbatim). */
export const IMPERSONATION_BANNER_COPY = Object.freeze({
  region: "CDS staff session",
  endLabel: "End viewing as CDS staff",
  warning: "5 minutes left viewing {business}",
});

/** Reason characters shown before the ellipsis (full text in `title`). */
export const BANNER_REASON_MAX = 40;
/** The warning threshold in minutes. */
export const BANNER_WARN_MINUTES = 5;
const TICK_MS = 30_000;

export interface ImpersonationBannerProps {
  business: string;
  view: "admin" | "owner";
  reason: string;
  /** ISO instant the 60-minute view ends. */
  endsAt: string;
  /** The End form's action (a Server Action in the app). */
  endAction: (formData: FormData) => void | Promise<void>;
  /** Called once when the time runs out (the app refreshes, the server ends the view). */
  onExpire?: () => void;
  /** Clock for tests. */
  now?: () => number;
}

/** Whole minutes left, rounded up, never below 0. */
export function minutesLeft(endsAt: string, nowMs: number): number {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - nowMs) / 60_000));
}

/** The reason cut to BANNER_REASON_MAX characters with an ellipsis. */
export function truncateReason(reason: string): string {
  const r = reason.trim();
  return r.length > BANNER_REASON_MAX
    ? `${r.slice(0, BANNER_REASON_MAX - 1).trimEnd()}…`
    : r;
}

/** BANNER split on its " · " separators, each part filled (copy stays in P13_COPY). */
function bannerParts(vars: Record<string, string | number>): string[] {
  return P13_COPY.BANNER.split(" · ").map((p) => fillCopy(p, vars));
}

export function ImpersonationBanner({
  business,
  view,
  reason,
  endsAt,
  endAction,
  onExpire,
  now = Date.now,
}: ImpersonationBannerProps) {
  const [mins, setMins] = useState(() => minutesLeft(endsAt, now()));
  const [announce, setAnnounce] = useState("");
  const warned = useRef(false);
  const expired = useRef(false);

  useEffect(() => {
    setMins(minutesLeft(endsAt, now()));
    const id = setInterval(() => setMins(minutesLeft(endsAt, now())), TICK_MS);
    return () => clearInterval(id);
  }, [endsAt, now]);

  useEffect(() => {
    if (mins <= BANNER_WARN_MINUTES && mins > 0 && !warned.current) {
      warned.current = true;
      setAnnounce(fillCopy(IMPERSONATION_BANNER_COPY.warning, { business }));
    }
    if (mins === 0 && !expired.current) {
      expired.current = true;
      onExpire?.();
    }
  }, [mins, business, onExpire]);

  const [who, as, why, left] = bannerParts({
    business,
    admin: view,
    reason: truncateReason(reason),
    minutes: mins,
  });
  const warn = mins <= BANNER_WARN_MINUTES;

  return (
    <CdsSurface
      as="section"
      flush
      role="region"
      aria-label={IMPERSONATION_BANNER_COPY.region}
      data-impersonation-banner=""
      className="sticky top-0 z-40 flex min-h-10 items-center gap-3 px-4 py-1 text-sm sm:px-6"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <CdsMark size={16} />
          <span className="truncate font-semibold">{who}</span>
        </span>
        <span aria-hidden="true" className="text-hub-ink-muted">
          {" · "}
        </span>
        <span className="text-hub-ink-muted">{as}</span>
        <span
          aria-hidden="true"
          className="hidden text-hub-ink-muted sm:inline"
        >
          {" · "}
        </span>
        <span
          className="order-last w-full truncate text-hub-ink-muted sm:order-none sm:w-auto sm:max-w-[40ch]"
          title={reason}
        >
          {why}
        </span>
        <span aria-hidden="true" className="text-hub-ink-muted">
          {" · "}
        </span>
        <span
          className={
            "flex items-center gap-1 tabular-nums " +
            (warn ? "font-semibold text-hub-ink" : "text-hub-ink-muted")
          }
        >
          <Timer aria-hidden size={14} strokeWidth={2} />
          {left}
        </span>
      </div>
      <form action={endAction} className="shrink-0">
        <button
          type="submit"
          aria-label={IMPERSONATION_BANNER_COPY.endLabel}
          className={`${buttonClasses("secondary", "sm")} min-h-11 sm:min-h-0`}
        >
          {P13_COPY.BANNER_END}
        </button>
      </form>
      <span className="sr-only" aria-live="polite" role="status">
        {announce}
      </span>
    </CdsSurface>
  );
}
