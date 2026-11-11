"use client";
// Today / badge refresh (13-47 choices 3, 4; D-UI-P13-20; 13-UI-SPEC "Today" Refresh). Calls
// `onRefresh` every 60 s while the tab is visible and whenever the window regains focus; no
// live region (the counts update silently). TodayRefresher also prefixes the page title with
// the attention count ("(3) Today · CDS staff").
import { useEffect, useRef } from "react";

export const TODAY_REFRESH_MS = 60_000;

export function useStaffRefresh(
  onRefresh: () => void,
  intervalMs: number = TODAY_REFRESH_MS,
): void {
  const cb = useRef(onRefresh);
  useEffect(() => {
    cb.current = onRefresh;
  }, [onRefresh]);
  useEffect(() => {
    const visible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";
    const timer = setInterval(() => {
      if (visible()) cb.current();
    }, intervalMs);
    const onFocus = () => cb.current();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [intervalMs]);
}

/** "(3) Today · CDS staff" from "Today · CDS staff"; an existing "(n) " prefix is replaced. */
export function withAttentionTitle(title: string, n: number): string {
  const bare = title.replace(/^\(\d+\)\s+/, "");
  return n > 0 ? `(${n}) ${bare}` : bare;
}

export function TodayRefresher({
  onRefresh,
  attention,
  intervalMs = TODAY_REFRESH_MS,
}: {
  onRefresh: () => void;
  /** Number of attention rows (title prefix). */
  attention: number;
  intervalMs?: number;
}) {
  useStaffRefresh(onRefresh, intervalMs);
  useEffect(() => {
    document.title = withAttentionTitle(document.title, attention);
  }, [attention]);
  return null;
}
