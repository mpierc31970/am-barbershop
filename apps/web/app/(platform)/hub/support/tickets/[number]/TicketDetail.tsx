"use client";
// Ticket detail body (12-20 choice 4; COMM-07, COMM-09, SUPPORT-02, D95; 12-UI-SPEC lines
// 421-455, states 742-743, destructive actions 812-822):
//   - "#1042 · status badge · Problem · Whole site" under the H1.
//   - ≥ 1024 px: thread column + the 360 px TicketMeta rail (sticky); below, the rail renders
//     above the thread and This is solved sits under it.
//   - Thread column: IncidentBox → PaidServicePanel (12-26) → Thread → the
//     composer by status: Waiting on you adds "CDS is waiting for your reply." above it,
//     Resolved adds RESOLVED-NOTE; Closed shows ClosedTicketPanel and no composer. Viewers get
//     VIEWER-READONLY, impersonating staff IMPERSONATING-SUPPORT (the Composer's read-only
//     state), and neither gets This is solved.
//   - Reply → replyTicketAction (Waiting on you / Resolved move to In progress on the server);
//     the newest 50 messages and the status come back and replace what is shown.
//   - This is solved → Resolved at once, Toast "Marked as solved." with Undo (8 s) →
//     undoSolvedAction (the server allows 30 s). A failure is an ERR-SAVE toast.
//   - Polls for new rows every 20 s while visible (useSupportPoll, 12-19); a CDS status line
//     refreshes the page so the badge and composer follow. Opening the ticket and new CDS
//     rows mark it read for this person (never while impersonating).
//   - Downloads mint a 15-minute link on click (mintSupportFileLinkAction).
//   - 12-26 (COMM-12, D103): a ticket linked to a known problem shows the IncidentBox first in
//     the thread column (title, public text, status only).
//   - 12-26 (SUPPORT-03, D297, D-UI-P12-12, D-UI-P12-13): a paid-marked ticket shows the
//     PaidServicePanel at the top of the thread column. Get a quote / Use my Care hour go to
//     requestPaidQuoteAction / useCareHourAction (Owner only; others see PAID-ASK-OWNER);
//     Show me how opens the category's help article in the TrainingDrawer (a read). While the
//     Owner still has a choice to make (isPrimaryChoice), the panel holds the primary and Send
//     reply renders secondary.
//   - 13-42 (STAFF-21, D212): the page passes the rating card as `rating`; it sits directly
//     under the thread, above the composer (`#rating`), while the live status is Resolved or
//     Closed (a reply that reopens the ticket hides it at once).
import {
  statusLabel,
  type IncidentView,
  type PaidService,
  type TenantMessage,
  type TenantTicket,
  type TicketStatus,
} from "@cds/core/support";
import type { OrgRole } from "@cds/core";
import { Badge, InlineAlert, useToast } from "@cds/ui/hub";
import { useHelpOpener } from "@cds/ui/hub/shell";
import {
  ClosedTicketPanel,
  Composer,
  IncidentBox,
  PaidServicePanel,
  SUPPORT_UI_COPY,
  Thread,
  TicketMeta,
  isPrimaryChoice,
  ticketStatusTone,
  ticketTypeShort,
  type CareUsage,
  type ComposerSendResult,
} from "@cds/ui/hub/support";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  loadEarlierMessagesAction,
  mintSupportFileLinkAction,
} from "../../../../../actions/support";
import {
  markSolvedAction,
  markTicketReadAction,
  replyTicketAction,
  undoSolvedAction,
  type TicketUpdate,
} from "../../../../../actions/support-tickets";
import {
  requestPaidQuoteAction,
  // Aliased: a server action, not a React hook (react-hooks/rules-of-hooks).
  useCareHourAction as careHourAction,
} from "../../../../../actions/support-paid";
import { GuardedLink } from "../../../GuardedLink";
import type { SupportAccess } from "../../SupportFrame";
import { SUPPORT_COPY } from "../../support-copy";
import { useSupportPoll } from "../../useSupportPoll";

export const TICKET_DETAIL_COPY = Object.freeze({
  waitingOnYou: "Support is waiting for your reply.",
  replyLabel: "Your reply",
  conversation: "Conversation",
});

/** The paid-service panel's data (12-26), built by the page from paidPanelFor. */
export type TicketPaid = {
  service: PaidService;
  /** The Owner when they may choose (not impersonated); null for everyone else. */
  role: OrgRole | null;
  careUsage: CareUsage | null;
};

export interface TicketDetailProps {
  ticket: TenantTicket;
  /** Time of CDS's first public reply, or null. */
  firstReplyAt: string | null;
  /** Newest 50 public messages, oldest first. */
  messages: TenantMessage[];
  hasEarlier: boolean;
  lastReadAt: string | null;
  access: SupportAccess;
  /** Paid-service panel; null when the ticket is not a paid service. */
  paid?: TicketPaid | null;
  /** The linked known problem's public view; null when none. */
  incident?: IncidentView | null;
  /** The rating card (13-42), shown under the thread while Resolved or Closed. */
  rating?: ReactNode;
  timeZone: string;
  nowMs: number;
}

/**
 * Replace the newest page, keeping any earlier rows already loaded above it. Rows the server
 * no longer returns inside the page (an undone solved line) drop out.
 */
export function mergePage(
  current: readonly TenantMessage[],
  page: readonly TenantMessage[],
): TenantMessage[] {
  const firstAt = page[0]?.created;
  if (!firstAt) return [...page];
  const older = current.filter((m) => m.created < firstAt);
  const ids = new Set(page.map((m) => m.id));
  return [...older.filter((m) => !ids.has(m.id)), ...page];
}

export function TicketDetail({
  ticket,
  firstReplyAt,
  messages: initialMessages,
  hasEarlier: initialHasEarlier,
  lastReadAt,
  access,
  paid = null,
  incident = null,
  rating = null,
  timeZone,
  nowMs,
}: TicketDetailProps) {
  const router = useRouter();
  const openHelp = useHelpOpener();
  const toast = useToast();
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [messages, setMessages] = useState<TenantMessage[]>(initialMessages);
  const [hasEarlier, setHasEarlier] = useState(initialHasEarlier);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [solving, setSolving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [readMark] = useState(lastReadAt);
  const flip = useRef(false);
  const writer = access === "write";

  // A server refresh (revalidation after an action, router.refresh) brings new props.
  useEffect(() => {
    setStatus(ticket.status);
  }, [ticket.status, ticket.lastActivityAt]);
  useEffect(() => {
    setMessages((cur) => mergePage(cur, initialMessages));
  }, [initialMessages]);

  // Opening the ticket marks its CDS replies read (once per open).
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || access === "impersonating") return;
    marked.current = true;
    // IN-C06: a rejected call (network drop, deploy skew) is never an unhandled rejection.
    void markTicketReadAction(ticket.id).catch(() => undefined);
  }, [access, ticket.id]);

  const announce = useCallback((text: string) => {
    flip.current = !flip.current;
    setAnnouncement(flip.current ? text : text + String.fromCharCode(0xa0));
  }, []);

  // WR-C02: a write that landed but whose refresh read failed comes back with no update;
  // fetch fresh server state instead of reporting a failure.
  const apply = useCallback(
    (u: TicketUpdate) => {
      if (u.status === null) {
        router.refresh();
        return;
      }
      const page = u.page;
      setStatus(u.status);
      setMessages((cur) => mergePage(cur, page.messages));
    },
    [router],
  );

  // IN-C07: what is shown, read synchronously in onNew so a re-delivered row (already shown)
  // is neither appended nor announced again.
  const shown = useRef(messages);
  useEffect(() => {
    shown.current = messages;
  }, [messages]);

  const onNew = useCallback(
    (rows: TenantMessage[]) => {
      const seen = new Set(shown.current.map((m) => m.id));
      const fresh = rows.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return;
      shown.current = [...shown.current, ...fresh];
      setMessages((cur) => {
        const have = new Set(cur.map((m) => m.id));
        const add = fresh.filter((m) => !have.has(m.id));
        return add.length > 0 ? [...cur, ...add] : cur;
      });
      const fromCds = fresh.filter((m) => m.authorKind === "staff").length;
      if (fromCds > 0) announce(SUPPORT_COPY.newMessages(fromCds));
      if (fresh.some((m) => m.authorKind === "system")) router.refresh();
      if (fromCds > 0 && access !== "impersonating") {
        void markTicketReadAction(ticket.id).catch(() => undefined);
      }
    },
    [access, announce, router, ticket.id],
  );

  const since = messages.at(-1)?.created ?? null;
  useSupportPoll({
    threadId: status === "closed" ? null : ticket.id,
    since,
    onNew,
  });

  const onSend = useCallback(
    async (body: string, tokens: string[]): Promise<ComposerSendResult> => {
      const res = await replyTicketAction(ticket.number, body, tokens);
      if (!res.ok) return { ok: false, code: res.code, error: res.message };
      apply(res.data);
      return { ok: true };
    },
    [apply, ticket.number],
  );

  const undo = useCallback(async () => {
    const res = await undoSolvedAction(ticket.number).catch(() => null);
    if (res?.ok) apply(res.data);
    else toast.show({ message: SUPPORT_UI_COPY.ERR_SAVE });
  }, [apply, ticket.number, toast]);

  const onSolved = useCallback(async () => {
    if (solving) return;
    setSolving(true);
    const res = await markSolvedAction(ticket.number).catch(() => null);
    setSolving(false);
    if (!res?.ok) {
      toast.show({ message: SUPPORT_UI_COPY.ERR_SAVE });
      return;
    }
    apply(res.data);
    toast.show({
      message: SUPPORT_UI_COPY.TOAST_SOLVED,
      action: {
        label: SUPPORT_UI_COPY.BUTTONS.undo,
        onClick: () => void undo(),
      },
    });
  }, [apply, solving, ticket.number, toast, undo]);

  const onLoadEarlier = useCallback(async () => {
    const first = messages[0];
    if (!first || loadingEarlier) return;
    setLoadingEarlier(true);
    const res = await loadEarlierMessagesAction(
      ticket.id,
      first.created,
      first.id,
    ).catch(() => null);
    setLoadingEarlier(false);
    if (!res?.ok) {
      setNotice(SUPPORT_UI_COPY.ERR_LOAD);
      return;
    }
    setMessages((cur) => {
      const seen = new Set(cur.map((m) => m.id));
      return [...res.data.messages.filter((m) => !seen.has(m.id)), ...cur];
    });
    setHasEarlier(res.data.hasEarlier);
  }, [loadingEarlier, messages, ticket.id]);

  const onDownload = useCallback(async (fileId: string) => {
    setNotice(null);
    const res = await mintSupportFileLinkAction(fileId).catch(() => null);
    if (!res) setNotice(SUPPORT_UI_COPY.ERR_LOAD);
    else if (res.ok) window.location.assign(res.data);
    else setNotice(res.message);
  }, []);

  const onGetQuote = useCallback(async () => {
    const res = await requestPaidQuoteAction(ticket.number);
    if (res.ok) router.refresh();
    return res;
  }, [router, ticket.number]);

  const onUseCare = useCallback(async () => {
    const res = await careHourAction(ticket.number);
    if (res.ok) router.refresh();
    return res;
  }, [router, ticket.number]);

  const onShowMe = useCallback(
    (helpId: string) => {
      if (openHelp) openHelp(helpId);
      else router.push(`/hub/help/${encodeURIComponent(helpId)}`);
    },
    [openHelp, router],
  );

  const choicePending =
    !!paid && status !== "closed" && isPrimaryChoice(paid.service, paid.role);

  const live: TenantTicket = { ...ticket, status };

  let end: React.ReactNode;
  if (status === "closed") {
    end = <ClosedTicketPanel ticket={live} LinkComponent={GuardedLink} />;
  } else {
    end = (
      <div className="flex flex-col gap-2" data-ticket-composer="">
        {writer && status === "waiting_on_you" ? (
          <p className="text-sm font-semibold" data-ticket-waiting="">
            {TICKET_DETAIL_COPY.waitingOnYou}
          </p>
        ) : null}
        {writer && status === "resolved" ? (
          <p className="text-sm text-hub-ink-muted" data-ticket-resolved="">
            {SUPPORT_UI_COPY.RESOLVED_NOTE}
          </p>
        ) : null}
        <Composer
          threadKey={ticket.id}
          label={TICKET_DETAIL_COPY.replyLabel}
          primary
          sendSecondary={choicePending}
          timeZone={timeZone}
          onSend={onSend}
          disabled={access === "viewer"}
          readOnlyReason={
            access === "impersonating"
              ? SUPPORT_UI_COPY.IMPERSONATING_SUPPORT
              : null
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p
        className="flex flex-wrap items-center gap-2 text-sm text-hub-ink-muted"
        data-ticket-line=""
      >
        <span className="font-semibold text-hub-ink tabular-nums">
          #{ticket.number}
        </span>
        <span aria-hidden>·</span>
        <Badge tone={ticketStatusTone(status)}>{statusLabel(status)}</Badge>
        <span aria-hidden>·</span>
        <span>
          {ticketTypeShort(ticket.type)} · {ticket.target.label}
        </span>
      </p>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="lg:order-2">
          <TicketMeta
            ticket={live}
            firstReplyAt={firstReplyAt}
            canWrite={writer}
            onSolved={() => void onSolved()}
            solving={solving}
            timeZone={timeZone}
            now={nowMs}
          />
        </div>
        <section
          aria-label={TICKET_DETAIL_COPY.conversation}
          className="flex min-w-0 flex-col gap-6 lg:order-1"
        >
          {notice ? <InlineAlert tone="error">{notice}</InlineAlert> : null}
          {incident ? (
            <IncidentBox incident={incident} timeZone={timeZone} />
          ) : null}
          {paid ? (
            <PaidServicePanel
              paid={paid.service}
              role={paid.role}
              careUsage={paid.careUsage}
              onGetQuote={onGetQuote}
              onUseCare={onUseCare}
              onShowMe={onShowMe}
              timeZone={timeZone}
              LinkComponent={GuardedLink}
            />
          ) : null}
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
            label={TICKET_DETAIL_COPY.conversation}
          />
          {rating && (status === "resolved" || status === "closed") ? (
            <div id="rating" className="scroll-mt-20">
              {rating}
            </div>
          ) : null}
          {end}
        </section>
      </div>
    </div>
  );
}
