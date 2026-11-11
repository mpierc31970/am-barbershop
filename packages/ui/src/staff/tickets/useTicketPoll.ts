"use client";
// Console polling (13-35 choice 3; STAFF-20, D211, D-UI-P13-20; 13-UI-SPEC "States"):
//   - useVisibleInterval(fn, ms): runs `fn` every `ms` while the tab is visible, and once when
//     it becomes visible again. The inbox list uses it with router.refresh() every 60 s.
//   - useTicketPoll({ number, cursor, poll, onResult }): the open ticket asks every 20 s for
//     messages after the last id it has (pollTicketAction, injected). One request at a time.
//     A failed poll retries silently; after 3 failures in a row `failed` turns true (the page
//     shows ERR-LOAD inline) until the next success.
// No @cds/db and no next/* import: the caller injects the action and the refresh.
import type { TicketStatus } from "@cds/core/support";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StaffActionResult } from "../dialogs";
import type { StaffThreadMessageView } from "./StaffThread";

/** Open ticket poll (D-UI-P13-20). */
export const TICKET_POLL_MS = 20_000;
/** Inbox list refresh (P12 list interval). */
export const INBOX_REFRESH_MS = 60_000;
/** Silent retries before ERR-LOAD shows. */
export const TICKET_POLL_RETRIES = 3;

function isVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

export function useVisibleInterval(
  fn: () => void | Promise<void>,
  ms: number,
  enabled = true,
): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!enabled || !(ms > 0)) return;
    const tick = () => {
      if (isVisible()) void ref.current();
    };
    const timer = setInterval(tick, ms);
    const onVisibility = () => {
      if (isVisible()) void ref.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}

export interface TicketPollResult {
  status: TicketStatus;
  messages: StaffThreadMessageView[];
  cursor: string;
  reset: boolean;
}

export interface UseTicketPollOptions {
  number: number;
  /** Id of the newest message shown ("" when the thread is empty). */
  cursor: string;
  poll: (
    number: number,
    cursor: string,
  ) => Promise<StaffActionResult<TicketPollResult>>;
  onResult: (r: TicketPollResult) => void;
  intervalMs?: number;
}

export function useTicketPoll({
  number,
  cursor,
  poll,
  onResult,
  intervalMs = TICKET_POLL_MS,
}: UseTicketPollOptions): { failed: boolean; pollNow: () => Promise<void> } {
  const cursorRef = useRef(cursor);
  // The ticket a request is in flight for (null when idle). One request per ticket at a time;
  // a request for a ticket no longer open never blocks the new ticket's first poll (CR-E01).
  const busyFor = useRef<number | null>(null);
  const numberRef = useRef(number);
  const failures = useRef(0);
  const [failed, setFailed] = useState(false);
  const onResultRef = useRef(onResult);
  const pollRef = useRef(poll);
  useEffect(() => {
    onResultRef.current = onResult;
    pollRef.current = poll;
  });
  // Another ticket opened in the same hook instance (split pane): start over from its cursor.
  useEffect(() => {
    if (numberRef.current === number) return;
    numberRef.current = number;
    cursorRef.current = cursor;
    failures.current = 0;
    setFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cursor is read only on a switch
  }, [number]);
  // The page's own send moves the cursor forward.
  useEffect(() => {
    if (cursor) cursorRef.current = cursor;
  }, [cursor]);

  const pollNow = useCallback(async () => {
    const asked = number;
    if (busyFor.current === asked) return;
    busyFor.current = asked;
    try {
      const r = await pollRef.current(asked, cursorRef.current);
      // Stale: another ticket is open now. Its thread, cursor and failures are untouched.
      if (numberRef.current !== asked) return;
      if (!r.ok) throw new Error(r.code);
      failures.current = 0;
      setFailed(false);
      if (r.data.cursor) cursorRef.current = r.data.cursor;
      onResultRef.current(r.data);
    } catch {
      if (numberRef.current !== asked) return;
      failures.current += 1;
      if (failures.current >= TICKET_POLL_RETRIES) setFailed(true);
    } finally {
      if (busyFor.current === asked) busyFor.current = null;
    }
  }, [number]);

  useVisibleInterval(pollNow, intervalMs);
  return { failed, pollNow };
}
