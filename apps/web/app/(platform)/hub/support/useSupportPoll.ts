"use client";
// useSupportPoll (12-19 choice 5; COMM-01; 12-UI-SPEC lines 294-297, D-UI-P12-9; T-12-19-03).
// While a thread is open, polls GET /hub/api/support?thread=&since= every 20 s, only while
// `document.visibilityState === "visible"` (a hidden tab polls nothing; the bell's 60 s read
// covers the rest of the hub), and once more when the page becomes visible again. The route
// returns `{ messages, now, cursor }`; the hook sends `cursor` back as `since`, so app and
// database clocks never need to agree (12-12 deviation 2). New rows are passed to `onNew`
// (de-duplicated by id); a failed read keeps what is shown and tries again next tick.
import type { TenantMessage } from "@cds/core/support";
import { useCallback, useEffect, useRef } from "react";

export const SUPPORT_POLL_URL = "/hub/api/support";
export const SUPPORT_POLL_MS = 20_000;

export interface UseSupportPollOptions {
  /** The thread being read; null (no conversation yet) polls nothing. */
  threadId: string | null;
  /** Newest message time already shown (ISO), or null. */
  since: string | null;
  onNew(messages: TenantMessage[]): void;
  intervalMs?: number;
  fetcher?: typeof fetch;
}

function isMessage(v: unknown): v is TenantMessage {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.body === "string" &&
    typeof o.created === "string" &&
    (o.authorKind === "member" ||
      o.authorKind === "staff" ||
      o.authorKind === "system") &&
    Array.isArray(o.attachments)
  );
}

export function supportPollUrl(threadId: string, since: string | null): string {
  const q = new URLSearchParams({ thread: threadId });
  if (since) q.set("since", since);
  return `${SUPPORT_POLL_URL}?${q.toString()}`;
}

export function useSupportPoll({
  threadId,
  since,
  onNew,
  intervalMs = SUPPORT_POLL_MS,
  fetcher,
}: UseSupportPollOptions) {
  const cursor = useRef<string | null>(since);
  const onNewRef = useRef(onNew);
  useEffect(() => {
    onNewRef.current = onNew;
  }, [onNew]);
  const busy = useRef(false);

  // A newer `since` from the page (own post, earlier load) moves the cursor forward only.
  useEffect(() => {
    if (!since) return;
    const cur = cursor.current ? Date.parse(cursor.current) : NaN;
    if (!Number.isFinite(cur) || Date.parse(since) > cur) {
      cursor.current = since;
    }
  }, [since]);

  const poll = useCallback(async (): Promise<void> => {
    if (!threadId || busy.current) return;
    busy.current = true;
    try {
      const f = fetcher ?? fetch;
      const res = await f(supportPollUrl(threadId, cursor.current), {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const json = (await res.json()) as Record<string, unknown> | null;
      if (!json || typeof json !== "object") return;
      if (typeof json.cursor === "string") cursor.current = json.cursor;
      const rows = Array.isArray(json.messages)
        ? json.messages.filter(isMessage)
        : [];
      if (rows.length > 0) onNewRef.current(rows);
    } catch {
      // Offline or a failed read: keep what is shown; the next tick tries again.
    } finally {
      busy.current = false;
    }
  }, [fetcher, threadId]);

  useEffect(() => {
    if (!threadId) return;
    const visible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";
    const timer = setInterval(() => {
      if (visible()) void poll();
    }, intervalMs);
    const onVisibility = () => {
      if (visible()) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, poll, threadId]);

  return { poll };
}
