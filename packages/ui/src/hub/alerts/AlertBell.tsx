"use client";
// Hub bell trigger + refresh hook (11-21; DASH-34, DASH-37; 11-UI-SPEC "Bell"; D-UI-P11-11,
// D-UI-P11-12). The count chip is neutral (ink on hub-surface-2), "9+" above nine; an urgent
// unread alert adds a TriangleAlert (danger) inside the chip, never a red chip. The count and
// urgent state live in the button's accessible name. A polite live region says "1 new alert"
// once per rise. useBellRefresh re-reads the count on navigation and every 60s while the page
// is visible (no websocket).
import { Bell, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "../IconButton";
import { bellChipText, bellLabel, newAlertsText } from "./copy";

export interface AlertBellProps {
  count: number;
  urgent: number;
  onOpen: () => void;
  /** Polite announcement text (useBellRefresh's `announcement`). */
  announcement?: string;
  expanded?: boolean;
}

export function AlertBell({
  count,
  urgent,
  onOpen,
  announcement = "",
  expanded,
}: AlertBellProps) {
  const n = count > 0 ? count : 0;
  return (
    <span className="relative inline-flex" data-alert-bell="">
      <IconButton
        label={bellLabel(n, urgent)}
        hideTooltip
        aria-haspopup="dialog"
        {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
        onClick={onOpen}
        icon={<Bell aria-hidden="true" size={20} strokeWidth={2} />}
      />
      {n > 0 ? (
        <span
          aria-hidden="true"
          data-bell-chip=""
          className={
            "pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center " +
            "justify-center gap-0.5 rounded-full border border-hub-border bg-hub-surface-2 " +
            "px-1 text-xs leading-none font-semibold text-hub-ink tabular-nums"
          }
        >
          {urgent > 0 ? (
            <TriangleAlert
              aria-hidden="true"
              size={14}
              strokeWidth={2}
              className="text-hub-danger"
              data-bell-urgent=""
            />
          ) : null}
          {bellChipText(n)}
        </span>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </span>
  );
}

export type BellCounts = { count: number; urgent: number };

export interface UseBellRefreshOptions {
  initial: BellCounts;
  /** Changes on every navigation (the pathname); a change re-reads the count. */
  refreshKey?: string;
  /** Count endpoint; defaults to the hub bell API. */
  url?: string;
  intervalMs?: number;
  fetcher?: typeof fetch;
}

export const BELL_COUNT_URL = "/hub/api/alerts?view=count";
export const BELL_REFRESH_MS = 60_000;

function countsOf(v: unknown): BellCounts | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const count = typeof o.count === "number" ? o.count : NaN;
  const urgent = typeof o.urgent === "number" ? o.urgent : 0;
  if (!Number.isFinite(count) || count < 0) return null;
  return { count: Math.trunc(count), urgent: Math.max(0, Math.trunc(urgent)) };
}

/**
 * The live bell count. Re-reads on `refreshKey` change, every `intervalMs` while
 * `document.visibilityState === "visible"`, and when the page becomes visible again. A
 * failed read keeps the last count (never a wrong number). `announcement` is set once per
 * rise ("2 new alerts").
 */
export function useBellRefresh({
  initial,
  refreshKey,
  url = BELL_COUNT_URL,
  intervalMs = BELL_REFRESH_MS,
  fetcher,
}: UseBellRefreshOptions) {
  const [counts, setCounts] = useState<BellCounts>(initial);
  const [announcement, setAnnouncement] = useState("");
  const last = useRef(initial.count);
  // Review 11 WR-D02: React skips a state update to the same text, so a second "1 new
  // alert" would leave the live region unchanged and say nothing. Every other announcement
  // carries a trailing no-break space, so the text node always changes.
  const flip = useRef(false);

  const apply = useCallback((next: BellCounts) => {
    const text = newAlertsText(last.current, next.count);
    last.current = next.count;
    setCounts(next);
    if (text) {
      flip.current = !flip.current;
      setAnnouncement(flip.current ? text : text + String.fromCharCode(0xa0));
    }
  }, []);

  // Review 11 WR-D01: a new server figure (a site switch revalidates the layout while the
  // shell stays mounted) re-seeds the count and the baseline, so the old site's count is
  // not shown and a different site's total is not announced as "new alerts".
  const seeded = useRef(initial);
  useEffect(() => {
    if (
      seeded.current.count === initial.count &&
      seeded.current.urgent === initial.urgent
    ) {
      return;
    }
    seeded.current = { count: initial.count, urgent: initial.urgent };
    last.current = initial.count;
    setCounts({ count: initial.count, urgent: initial.urgent });
  }, [initial.count, initial.urgent]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const f = fetcher ?? fetch;
      const res = await f(url, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const next = countsOf(await res.json());
      if (next) apply(next);
    } catch {
      // Offline or a failed read: keep the last count.
    }
  }, [apply, fetcher, url]);

  // Navigation: skip the first render (the server already sent the count).
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    void refresh();
  }, [refreshKey, refresh]);

  useEffect(() => {
    const visible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";
    const timer = setInterval(() => {
      if (visible()) void refresh();
    }, intervalMs);
    const onVisibility = () => {
      if (visible()) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, refresh]);

  /** Local update after a read action (no announcement for a drop). */
  const set = useCallback((next: BellCounts) => {
    last.current = next.count;
    setCounts(next);
  }, []);

  return { ...counts, announcement, refresh, set };
}
