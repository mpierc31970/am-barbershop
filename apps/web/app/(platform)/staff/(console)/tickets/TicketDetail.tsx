"use client";
// Staff ticket detail (13-35 choices 3, 4; STAFF-05, STAFF-08, STAFF-12, STAFF-20; D96, D211;
// 13-UI-SPEC "Ticket detail" lines 428-474, states 1010-1014, responsive 1124-1127). Used on
// /staff/tickets/<number> and in the inbox split pane:
//   - TicketHeaderStrip, then the thread column: IncidentBox (when linked; staff see what the
//     owner sees) → StaffThread (internal notes marked) → the `composer` slot (13-41 fills it;
//     empty here) and the TicketRail: ≥ 1280px a 320px column on the right, narrower a
//     <details> "Ticket details" between thread and composer (open by default ≥ 640px).
//   - Rail changes call the 13-28 actions (staffReplyAction status / assign / priority,
//     staffMarkPaidAction, staffLinkIncidentAction), then router.refresh() so the header and
//     the inbox follow.
//   - Polls every 20 s (pollTicketAction, cursor = last message id): new messages are appended
//     and announced; a reset replaces the thread; a status change refreshes the page. Three
//     failed polls in a row show ERR-LOAD + Try again.
//   - Downloads open /staff/api/support-file/<id> (staff session, support_read).
//   - 13-41 choice 6: the composer slot defaults to StaffComposer (data.composer: canned
//     replies + placeholder values; absent for Closed tickets and roles without
//     support_reply). Replies without files call staffReplyAction; with files they POST
//     multipart to /staff/api/tickets/<n>/reply (P13-P20). A send toasts the CLI line and
//     refreshes. Shortcuts (useInboxShortcuts): r reply, n internal note, / canned, a assign to
//     me, e status (focuses the rail's Status), Esc back (closes the split pane / back to the
//     inbox). j / k stay with the inbox StaffTable.
import { IncidentBox } from "@cds/ui/hub/support";
import { InlineAlert, useToast } from "@cds/ui/hub";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import { P13_COPY } from "@cds/core/staff";
import {
  STAFF_TICKETS_COPY,
  StaffComposer,
  StaffThread,
  TicketHeaderStrip,
  TicketRail,
  useInboxShortcuts,
  useTicketPoll,
  type StaffComposerHandle,
  type StaffComposerResult,
  type StaffComposerSendInput,
  type StaffThreadMessageView,
  type TicketPollResult,
} from "@cds/ui/staff";
import type { PaidCategory, Priority, TicketStatus } from "@cds/core/support";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  pollTicketAction,
  staffLinkIncidentAction,
  staffMarkPaidAction,
  staffReplyAction,
} from "../../../../actions/staff/tickets";
import type { TicketDetailData } from "./ticket-data";

export interface TicketDetailProps {
  data: TicketDetailData;
  /** Inbox split pane (H2, focus on open, Open on its own page, close). */
  split?: boolean;
  closeHref?: string;
  /** 13-41 composer slot, rendered under the thread. */
  composer?: ReactNode;
}

const C = STAFF_TICKETS_COPY;

const INBOX_HREF = "/staff/tickets?tab=inbox";

export function staffReplyHref(n: number): string {
  return `/staff/api/tickets/${encodeURIComponent(String(n))}/reply`;
}

/** POST a reply with files to the route handler; its JSON mapped to the composer result. */
export async function sendReplyWithFiles(
  n: number,
  form: FormData,
): Promise<StaffComposerResult> {
  let res: Response;
  try {
    res = await fetch(staffReplyHref(n), {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
  } catch {
    return { ok: false };
  }
  let data: { message?: unknown; error?: unknown; code?: unknown } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    data = {};
  }
  if (res.ok && typeof data.message === "string") {
    return { ok: true, message: data.message };
  }
  if (res.status === 401) {
    return {
      ok: false,
      code: "invalid_input",
      message: P13_COPY.SESSION_ENDED,
    };
  }
  return {
    ok: false,
    code:
      res.status === 400 || res.status === 413 ? "invalid_input" : undefined,
    message: typeof data.error === "string" ? data.error : undefined,
  };
}

export function staffFileHref(fileId: string): string {
  return `/staff/api/support-file/${encodeURIComponent(fileId)}`;
}

export function mergeMessages(
  shown: readonly StaffThreadMessageView[],
  r: Pick<TicketPollResult, "messages" | "reset">,
): StaffThreadMessageView[] {
  if (r.reset) return [...r.messages];
  const ids = new Set(shown.map((m) => m.id));
  return [...shown, ...r.messages.filter((m) => !ids.has(m.id))];
}

export function TicketDetail({
  data,
  split = false,
  closeHref,
  composer,
}: TicketDetailProps) {
  const router = useRouter();
  const toast = useToast();
  const composerRef = useRef<StaffComposerHandle>(null);
  const [messages, setMessages] = useState(data.messages);
  const [announcement, setAnnouncement] = useState("");
  const status = useRef<TicketStatus>(data.header.status);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // A fresh server read (router.refresh, another ticket) replaces what is shown.
  useEffect(() => {
    setMessages(data.messages);
    status.current = data.header.status;
  }, [data]);

  // Phones get the rail closed (UI-SPEC: open by default ≥ 640px).
  useEffect(() => {
    try {
      if (window.matchMedia?.("(max-width: 639px)").matches) {
        detailsRef.current?.removeAttribute("open");
      }
    } catch {
      /* keep it open */
    }
  }, []);

  const onResult = useCallback(
    (r: TicketPollResult) => {
      if (r.messages.length > 0 || r.reset) {
        setMessages((shown) => mergeMessages(shown, r));
        if (r.messages.length > 0) {
          setAnnouncement(C.newMessages(r.messages.length));
        }
      }
      if (r.status !== status.current) {
        status.current = r.status;
        router.refresh();
      }
    },
    [router],
  );

  const { failed, pollNow } = useTicketPoll({
    number: data.number,
    cursor: messages.at(-1)?.id ?? "",
    poll: pollTicketAction,
    onResult,
  });

  const after = useCallback(
    async <T,>(p: Promise<T>): Promise<T> => {
      const r = await p;
      if ((r as { ok?: boolean }).ok) router.refresh();
      return r;
    },
    [router],
  );

  const onSend = useCallback(
    async (input: StaffComposerSendInput): Promise<StaffComposerResult> => {
      const r = await staffReplyAction(input);
      return r.ok
        ? { ok: true, message: r.data.message }
        : { ok: false, code: r.code, message: r.message };
    },
    [],
  );

  const onSent = useCallback(
    (message: string) => {
      toast.show({ message });
      router.refresh();
    },
    [toast, router],
  );

  const hasComposer = !composer && data.composer !== null;
  useInboxShortcuts({
    onReply: hasComposer
      ? () => composerRef.current?.focus("public")
      : undefined,
    onNote: hasComposer
      ? () => composerRef.current?.focus("internal")
      : undefined,
    onCanned: hasComposer ? () => composerRef.current?.openCanned() : undefined,
    onAssignMe:
      data.rail.status === "closed"
        ? undefined
        : () => {
            void staffReplyAction({ number: data.number, assign: "me" }).then(
              (r) => {
                toast.show({ message: r.ok ? r.data.message : r.message });
                if (r.ok) router.refresh();
              },
              // WR-D06: a network drop or a thrown action shows ERR_SEND, never silence.
              () => toast.show({ message: P13_COPY.ERR_SEND }),
            );
          },
    onStatus: () => {
      detailsRef.current?.setAttribute("open", "");
      document
        .querySelector<HTMLSelectElement>(
          `[data-ticket-rail="${data.number}"] select`,
        )
        ?.focus();
    },
    onBack: () => router.push(split && closeHref ? closeHref : INBOX_HREF),
  });

  const onDownload = useCallback((fileId: string) => {
    window.open(staffFileHref(fileId), "_blank", "noopener");
  }, []);

  const rail = (
    <TicketRail
      ticket={data.rail}
      staff={data.staff}
      meId={data.meId}
      incidents={data.incidents}
      timeZone={data.timeZone}
      onStatus={(n: number, to: TicketStatus) =>
        after(staffReplyAction({ number: n, status: to }))
      }
      onAssign={(n: number, v: string) =>
        after(staffReplyAction({ number: n, assign: v }))
      }
      onPriority={(n: number, p: Priority) =>
        after(staffReplyAction({ number: n, priority: p }))
      }
      onPaid={(n: number, c: PaidCategory) => after(staffMarkPaidAction(n, c))}
      onIncident={(n: number, code: string) =>
        after(staffLinkIncidentAction(n, code))
      }
    />
  );

  return (
    <div
      data-staff-ticket={data.number}
      className="flex flex-col gap-4 font-hub text-hub-ink"
    >
      <TicketHeaderStrip
        ticket={data.header}
        now={data.now}
        split={split}
        closeHref={closeHref}
        timeZone={data.timeZone}
      />
      {failed ? (
        <InlineAlert
          tone="error"
          action={
            <button
              type="button"
              onClick={() => void pollNow()}
              className="rounded font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
            >
              {SUPPORT_UI_COPY.BUTTONS.tryAgain}
            </button>
          }
        >
          {SUPPORT_UI_COPY.ERR_LOAD}
        </InlineAlert>
      ) : null}
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="order-1 min-w-0 xl:col-start-1 xl:row-start-1">
          <StaffThread
            messages={messages}
            timeZone={data.timeZone}
            now={Date.parse(data.now)}
            onDownload={onDownload}
            announcement={announcement}
            before={
              data.incidentView ? (
                <IncidentBox
                  incident={data.incidentView}
                  at={data.incidentAt}
                  timeZone={data.timeZone}
                  headingLevel={split ? "h3" : "h2"}
                />
              ) : null
            }
          />
        </div>
        <details
          ref={detailsRef}
          open
          className="order-2 xl:sticky xl:top-[72px] xl:col-start-2 xl:row-span-2 xl:row-start-1"
        >
          <summary className="mb-2 cursor-pointer text-sm font-semibold text-hub-ink xl:hidden">
            {C.rail.heading}
          </summary>
          {rail}
        </details>
        {composer ? (
          <div className="order-3 min-w-0 xl:col-start-1 xl:row-start-2">
            {composer}
          </div>
        ) : data.composer ? (
          <div className="order-3 min-w-0 xl:col-start-1 xl:row-start-2">
            <StaffComposer
              key={data.number}
              ticket={data.composer.ticket}
              canned={data.composer.canned}
              vars={data.composer.vars}
              timeZone={data.timeZone}
              onSend={onSend}
              onSendWithFiles={(form) => sendReplyWithFiles(data.number, form)}
              onSent={onSent}
              handleRef={composerRef}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
