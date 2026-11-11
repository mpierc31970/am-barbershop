"use client";
// Thread (12-09 choices 1, 5; COMM-01, COMM-05, COMM-08; 12-UI-SPEC lines 283-298, 301-333,
// 828-857). The conversation as an ordered record, oldest at the top: an <ol> whose items are
// day separators (<h3>), one unread divider, messages (<article>) and system lines.
//   - Plain data in, callbacks out: the page owns every server call (onDownload mints the
//     signed link, onLoadEarlier fetches 50 more). No @cds/db import.
//   - The unread divider sits above the first line after `lastReadAt` that someone else
//     wrote (the viewer's own lines are never unread).
//   - On first render the view scrolls to the unread divider (smooth 200ms; instant under
//     reduced motion). New messages are announced by the page through `announcement`
//     (polite live region, at most once per poll).
import type { TenantAttachment, TenantMessage } from "@cds/core/support";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "../../Button";
import { SUPPORT_UI_COPY } from "../copy";
import { dayKey, dayLabel, parseTime, THREAD_COPY } from "./copy";
import { DaySeparator, UnreadDivider } from "./DaySeparator";
import { SystemLine } from "./SystemLine";
import { ThreadMessage } from "./ThreadMessage";

export interface ThreadProps {
  /** Oldest first. */
  messages: readonly TenantMessage[];
  /** Business time zone of the site. */
  timeZone: string;
  /** Epoch ms used for "Today" / "Yesterday" (injectable clock). */
  now?: number;
  /** ISO time the viewer last read this thread; null or absent = no divider. */
  lastReadAt?: string | null;
  /** The viewer wrote this message (shown as "You", never unread). */
  isOwn?(message: TenantMessage): boolean;
  onDownload(fileId: string): void | Promise<void>;
  previewSrc?(attachment: TenantAttachment): string | null;
  /** More than the loaded 50: show "Show earlier messages" at the top. */
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?(): void;
  /** Polite announcement for newly arrived messages ("1 new message from CDS"). */
  announcement?: string;
  /** Accessible name of the list. */
  label?: string;
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/** Index of the first message after lastReadAt written by someone else, or -1. */
export function firstUnreadIndex(
  messages: readonly TenantMessage[],
  lastReadAt: string | null | undefined,
  isOwn?: (m: TenantMessage) => boolean,
): number {
  if (!lastReadAt) return -1;
  const read = parseTime(lastReadAt);
  if (!Number.isFinite(read)) return -1;
  return messages.findIndex((m) => {
    if (m.authorKind === "member" && isOwn?.(m)) return false;
    if (m.authorKind === "member" && !isOwn) return false;
    const t = parseTime(m.created);
    return Number.isFinite(t) && t > read;
  });
}

export function Thread({
  messages,
  timeZone,
  now,
  lastReadAt,
  isOwn,
  onDownload,
  previewSrc,
  hasEarlier = false,
  loadingEarlier = false,
  onLoadEarlier,
  announcement,
  label = THREAD_COPY.threadLabel,
}: ThreadProps) {
  const dividerId = useId();
  const scrolled = useRef(false);
  const at = now ?? Date.now();
  const unreadAt = firstUnreadIndex(messages, lastReadAt, isOwn);

  // Decided once, on the first commit (12-REVIEW WR-D03): a divider that first appears
  // because a poll brought a message must not move someone who is reading or typing.
  useEffect(() => {
    if (scrolled.current) return;
    scrolled.current = true;
    if (unreadAt < 0) return;
    const el = document.getElementById(dividerId);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({
        block: "start",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [dividerId, unreadAt]);

  const items: ReactNode[] = [];
  let lastDay = "";
  messages.forEach((m, i) => {
    const day = dayKey(m.created, timeZone);
    if (day && day !== lastDay) {
      lastDay = day;
      items.push(
        <li key={`day-${day}`}>
          <DaySeparator label={dayLabel(m.created, timeZone, at)} />
        </li>,
      );
    }
    if (i === unreadAt) {
      items.push(
        <li key="unread">
          <UnreadDivider id={dividerId} />
        </li>,
      );
    }
    items.push(
      <li key={m.id}>
        {m.authorKind === "system" ? (
          <SystemLine message={m} timeZone={timeZone} />
        ) : (
          <ThreadMessage
            message={m}
            timeZone={timeZone}
            own={m.authorKind === "member" && Boolean(isOwn?.(m))}
            onDownload={onDownload}
            previewSrc={previewSrc}
          />
        )}
      </li>,
    );
  });

  return (
    <div className="flex flex-col gap-4">
      {hasEarlier ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            loading={loadingEarlier}
            onClick={() => onLoadEarlier?.()}
          >
            {SUPPORT_UI_COPY.BUTTONS.showEarlier}
          </Button>
        </div>
      ) : null}
      <ol aria-label={label} className="flex flex-col gap-4">
        {items}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement ?? ""}
      </p>
    </div>
  );
}
