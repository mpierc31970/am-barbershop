"use client";
// Messages tab (12-19 choices 4, 5; COMM-01, COMM-02, COMM-07; 12-UI-SPEC "Messages" lines
// 274-297, states 735-737). The client island under the server loader in page.tsx:
//   1. Pinned CDS notes (CdsNoteCard, newest first), 2. Earlier notes (<details>), 3. "Messages
//   with CDS" + the Thread (oldest at top, unread divider from support_read, Show earlier
//   messages loads 50 more keeping the scroll position), 4. the Composer "Write to CDS"
//   (secondary Send message) with the reply-time line under it.
//   - No messages yet: EmptyState MSG-EMPTY, the composer still below it.
//   - Opening the tab marks the notes and the conversation read for this person (the actions
//     are no-ops while impersonating).
//   - New CDS messages arrive by useSupportPoll (20 s while visible): appended, announced in a
//     polite live region ("1 new message from CDS"); if the person has scrolled up the view
//     stays put and a floating "1 new message" button scrolls down.
//   - Viewers: VIEWER-READONLY instead of the composer; impersonating staff:
//     IMPERSONATING-SUPPORT (both from the Composer's read-only state).
//   - Downloads: a signed link is minted on click (mintSupportFileLinkAction), never in markup.
import type { CdsNote, TenantMessage } from "@cds/core/support";
import { Button, EmptyState, InlineAlert } from "@cds/ui/hub";
import {
  CdsNoteCard,
  Composer,
  EarlierNotes,
  SUPPORT_UI_COPY,
  Thread,
  type ComposerSendResult,
} from "@cds/ui/hub/support";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadEarlierMessagesAction,
  markConversationReadAction,
  markNotesReadAction,
  mintSupportFileLinkAction,
  postConversationMessageAction,
} from "../../../actions/support";
import type { SupportAccess } from "./SupportFrame";
import { SUPPORT_COPY } from "./support-copy";
import { useSupportPoll } from "./useSupportPoll";

export type MessagesNote = CdsNote & { unread: boolean };

export interface MessagesPanelProps {
  threadId: string | null;
  /** Newest 50 public messages, oldest first. */
  messages: TenantMessage[];
  hasEarlier: boolean;
  /** This person's last read time of the conversation (support_read), or null. */
  lastReadAt: string | null;
  pinned: MessagesNote[];
  earlier: MessagesNote[];
  timeZone: string;
  access: SupportAccess;
  /** Server clock (epoch ms) for Today / Yesterday, so server and client agree. */
  nowMs: number;
}

/** True when the bottom of `el` is below the visible window (the person scrolled up). */
function scrolledUp(el: HTMLElement | null): boolean {
  if (!el || typeof window === "undefined") return false;
  return el.getBoundingClientRect().bottom > window.innerHeight + 48;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function MessagesPanel({
  threadId: initialThreadId,
  messages: initialMessages,
  hasEarlier: initialHasEarlier,
  lastReadAt,
  pinned,
  earlier,
  timeZone,
  access,
  nowMs,
}: MessagesPanelProps) {
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState<TenantMessage[]>(initialMessages);
  const [hasEarlier, setHasEarlier] = useState(initialHasEarlier);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pendingNew, setPendingNew] = useState(0);
  // The divider marks what was unread when the tab opened; it never moves while reading.
  const [readMark] = useState(lastReadAt);
  const threadRef = useRef<HTMLDivElement>(null);
  const flip = useRef(false);

  // Opening the tab marks the notes and the conversation read (once per open).
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || access === "impersonating") return;
    marked.current = true;
    if ([...pinned, ...earlier].some((n) => n.unread)) {
      void markNotesReadAction().catch(() => undefined);
    }
    // IN-C06: a rejected call (network drop, deploy skew) is never an unhandled rejection.
    if (initialThreadId) {
      void markConversationReadAction(initialThreadId).catch(() => undefined);
    }
  }, [access, earlier, initialThreadId, pinned]);

  const announce = useCallback((text: string) => {
    flip.current = !flip.current;
    setAnnouncement(flip.current ? text : text + String.fromCharCode(0xa0));
  }, []);

  // Ids already shown (initial, polled, posted, earlier): the poll never duplicates a row.
  const shown = useRef(new Set(initialMessages.map((m) => m.id)));

  const append = useCallback((rows: TenantMessage[]): TenantMessage[] => {
    const fresh = rows.filter((m) => !shown.current.has(m.id));
    for (const m of fresh) shown.current.add(m.id);
    if (fresh.length > 0) setMessages((cur) => [...cur, ...fresh]);
    return fresh;
  }, []);

  const onNew = useCallback(
    (rows: TenantMessage[]) => {
      const up = scrolledUp(threadRef.current);
      const fresh = append(rows);
      const fromCds = fresh.filter((m) => m.authorKind !== "member").length;
      if (fromCds === 0) return;
      announce(SUPPORT_COPY.newMessages(fromCds));
      if (up) setPendingNew((n) => n + fromCds);
      if (threadId && access !== "impersonating") {
        void markConversationReadAction(threadId).catch(() => undefined);
      }
    },
    [access, announce, append, threadId],
  );

  // WR-C01: the poll cursor comes from the server only (the first load, then each poll's
  // `cursor`). The person's own post never moves it forward, or a CDS reply created between
  // the last poll and the post would be skipped. After a send, poll at once to fetch any gap
  // (the posted row comes back too and is de-duplicated by id).
  const [since] = useState(initialMessages.at(-1)?.created ?? null);
  const { poll } = useSupportPoll({ threadId, since, onNew });
  const [sent, setSent] = useState(0);
  useEffect(() => {
    if (sent > 0) void poll();
  }, [poll, sent]);

  // Scrolling back to the bottom clears the floating button.
  useEffect(() => {
    if (pendingNew === 0) return;
    const onScroll = () => {
      if (!scrolledUp(threadRef.current)) setPendingNew(0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pendingNew]);

  const jumpDown = useCallback(() => {
    setPendingNew(0);
    const el = threadRef.current;
    if (!el) return;
    const items = el.querySelectorAll("li");
    const last = items[items.length - 1] ?? el;
    last.scrollIntoView({
      block: "end",
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }, []);

  const onSend = useCallback(
    async (body: string, tokens: string[]): Promise<ComposerSendResult> => {
      const res = await postConversationMessageAction(body, tokens);
      if (!res.ok) return { ok: false, code: res.code, error: res.message };
      setThreadId(res.data.threadId);
      append([res.data.message]);
      setSent((n) => n + 1);
      return { ok: true };
    },
    [append],
  );

  const onLoadEarlier = useCallback(async () => {
    const first = messages[0];
    if (!threadId || !first || loadingEarlier) return;
    setLoadingEarlier(true);
    setEarlierError(null);
    const before = document.documentElement.scrollHeight;
    const res = await loadEarlierMessagesAction(
      threadId,
      first.created,
      first.id,
    ).catch(() => null);
    setLoadingEarlier(false);
    if (!res?.ok) {
      setEarlierError(SUPPORT_UI_COPY.ERR_LOAD);
      return;
    }
    const older = res.data.messages.filter((m) => !shown.current.has(m.id));
    for (const m of older) shown.current.add(m.id);
    setMessages((cur) => [...older, ...cur]);
    setHasEarlier(res.data.hasEarlier);
    // Keep the reading position: shift by the height the older rows added.
    requestAnimationFrame(() => {
      const grew = document.documentElement.scrollHeight - before;
      if (grew > 0) window.scrollBy(0, grew);
    });
  }, [loadingEarlier, messages, threadId]);

  const onDownload = useCallback(async (fileId: string) => {
    setDownloadError(null);
    const res = await mintSupportFileLinkAction(fileId).catch(() => null);
    if (!res) setDownloadError(SUPPORT_UI_COPY.ERR_LOAD);
    else if (res.ok) window.location.assign(res.data);
    else setDownloadError(res.message);
  }, []);

  const readOnlyReason =
    access === "impersonating" ? SUPPORT_UI_COPY.IMPERSONATING_SUPPORT : null;

  return (
    <div className="flex flex-col gap-4" data-messages-panel="">
      {pinned.length > 0 ? (
        <ul className="flex flex-col gap-4" data-support-pinned="">
          {pinned.map((n) => (
            <CdsNoteCard
              key={n.id}
              as="li"
              note={n}
              unread={n.unread}
              timeZone={timeZone}
            />
          ))}
        </ul>
      ) : null}
      <EarlierNotes
        notes={earlier}
        unreadIds={earlier.filter((n) => n.unread).map((n) => n.id)}
        timeZone={timeZone}
      />
      <section
        aria-labelledby="support-conversation-h"
        className="mt-2 flex flex-col gap-4"
      >
        <h2 id="support-conversation-h" className="text-xl font-semibold">
          {SUPPORT_COPY.conversationHeading}
        </h2>
        {earlierError ? (
          <InlineAlert tone="error">{earlierError}</InlineAlert>
        ) : null}
        {downloadError ? (
          <InlineAlert tone="error">{downloadError}</InlineAlert>
        ) : null}
        {messages.length === 0 ? (
          <div data-support-empty="">
            <EmptyState
              heading={SUPPORT_UI_COPY.MSG_EMPTY_H}
              body={SUPPORT_UI_COPY.MSG_EMPTY_B}
            />
            <span role="status" aria-live="polite" className="sr-only">
              {announcement}
            </span>
          </div>
        ) : (
          <div ref={threadRef} className="relative">
            <Thread
              messages={messages}
              timeZone={timeZone}
              now={nowMs}
              lastReadAt={readMark}
              onDownload={onDownload}
              hasEarlier={hasEarlier}
              loadingEarlier={loadingEarlier}
              onLoadEarlier={() => void onLoadEarlier()}
              announcement={announcement}
              label={SUPPORT_COPY.conversationHeading}
            />
            {pendingNew > 0 ? (
              <div className="pointer-events-none sticky bottom-4 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={jumpDown}
                  className="pointer-events-auto shadow-sm"
                  data-support-new-jump=""
                >
                  {SUPPORT_COPY.newMessagesButton(pendingNew)}
                  <ArrowDown aria-hidden="true" size={14} strokeWidth={2} />
                </Button>
              </div>
            ) : null}
          </div>
        )}
        <Composer
          threadKey={threadId ?? "conversation"}
          label={SUPPORT_COPY.composerLabel}
          timeZone={timeZone}
          onSend={onSend}
          disabled={access === "viewer"}
          readOnlyReason={readOnlyReason}
          footer={
            <p className="text-sm text-hub-ink-muted">
              {SUPPORT_COPY.composerFooter}
            </p>
          }
        />
      </section>
    </div>
  );
}
