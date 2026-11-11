// Ticket detail (12-20 choice 4; COMM-07, COMM-09, SUPPORT-02, D95, D211; 12-UI-SPEC "Ticket
// detail" lines 421-455, states 742-743). "← Tickets", ScreenHeader (subject, "?" help id
// `support.follow-ticket`, 12-33), then TicketDetail: the "#1042 · status · type · target" line, the
// TicketMeta rail (sticky ≥ 1024 px, above the thread below), the thread and the composer or
// the closed panel.
//   - One hub 404 for a missing number, another site's number and junk ("abc"): the number is
//     parsed (NotFound) and read scoped to the session org; NotFound / Forbidden → notFound()
//     (T-12-20-01). Grants-only roles (no support:read) get the same 404.
//   - A failed read shows ERR-LOAD with Try again.
//   - Reading the ticket is marked by the client on open (markTicketReadAction), as Messages
//     does; impersonating staff mark nothing.
//   - 12-26 (SUPPORT-03): a paid-marked ticket also loads paidPanelFor (the panel's state,
//     the Owner's Care minutes) for the PaidServicePanel. A failed load logs the error class
//     and shows the ticket without the panel.
//   - 12-26 (COMM-12, D103): a ticket linked to a known problem loads incidentForTicket (the
//     IncidentView: title, public text, status only; T-12-26-03). A failed load logs the error
//     class and shows the ticket without the box.
//   - 13-42 (STAFF-21, D212): a Resolved or Closed ticket also loads ticketRatingView (the
//     stored rating and whether this person may rate) and mounts the rating card under the
//     thread. A failed read logs the class name and shows the ticket without the card.
import { CdsError, can } from "@cds/core";
import { parseTicketNumber, type IncidentView } from "@cds/core/support";
import {
  getBusinessProfile,
  getTicketByNumber,
  incidentForTicket,
  listThreadMessages,
  paidPanelFor,
  readSupportRead,
  ticketRatingView,
  type OrgContext,
  type PaidPanelView,
  type TenantTicketDetail,
  type ThreadMessagesPage,
  type TicketRatingView,
} from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import { SUPPORT_UI_COPY } from "@cds/ui/hub/support";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireHubSession } from "../../../../../../lib/session";
import { GuardedLink } from "../../../GuardedLink";
import type { SupportAccess } from "../../SupportFrame";
import { TicketDetail, type TicketPaid } from "./TicketDetail";
import { TicketRating } from "./TicketRating";

export const metadata: Metadata = { title: "Ticket" };

export const dynamic = "force-dynamic";

const TICKETS_HREF = "/hub/support?tab=tickets";
const BACK_LINK =
  "inline-flex items-center gap-1 self-start rounded text-sm font-semibold text-hub-accent " +
  "underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-hub-accent";
const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

/** The "?" on a ticket opens Follow a ticket (12-33). */
const TICKET_HELP_ID = "support.follow-ticket";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function isMissing(err: unknown): boolean {
  return (
    err instanceof CdsError &&
    (err.code === "not_found" || err.code === "forbidden")
  );
}

type Loaded =
  | {
      kind: "ok";
      ticket: TenantTicketDetail;
      page: ThreadMessagesPage;
      lastReadAt: string | null;
      paid: PaidPanelView | null;
      incident: IncidentView | null;
      rating: TicketRatingView | null;
    }
  | { kind: "missing" }
  | { kind: "error" };

async function load(ctx: OrgContext, raw: string): Promise<Loaded> {
  let n: number;
  try {
    n = parseTicketNumber(raw);
  } catch {
    return { kind: "missing" };
  }
  try {
    const ticket = await getTicketByNumber(ctx, String(n));
    const rated = ticket.status === "resolved" || ticket.status === "closed";
    const [page, read, paid, incident, rating] = await Promise.all([
      listThreadMessages(ctx, ticket.id),
      readSupportRead(ctx).catch((err: unknown) => {
        console.error(`[hub] ticket read state failed ${errName(err)}`);
        return {} as Record<string, string>;
      }),
      ticket.paid
        ? paidPanelFor(ctx, n).catch((err: unknown) => {
            console.error(`[hub] ticket paid panel failed ${errName(err)}`);
            return null;
          })
        : Promise.resolve(null),
      ticket.hasIncident
        ? incidentForTicket(ctx, n).catch((err: unknown) => {
            console.error(`[hub] ticket incident failed ${errName(err)}`);
            return null;
          })
        : Promise.resolve(null),
      rated
        ? Promise.resolve()
            .then(() => ticketRatingView(ctx, n))
            .catch((err: unknown) => {
              console.error(`[hub] ticket rating failed ${errName(err)}`);
              return null;
            })
        : Promise.resolve(null),
    ]);
    return {
      kind: "ok",
      ticket,
      page,
      lastReadAt: read[ticket.id] ?? null,
      paid,
      incident,
      rating,
    };
  } catch (err) {
    if (isMissing(err)) return { kind: "missing" };
    console.error(`[hub] ticket load failed ${errName(err)}`);
    return { kind: "error" };
  }
}

/**
 * The panel's props from the chokepoint view (12-26 choice 1). Only a chooser (the Owner,
 * not impersonated) is passed as the Owner, so everyone else sees PAID-ASK-OWNER; the Care
 * block is there only for the Owner on the Care Plan.
 */
function paidProps(ctx: OrgContext, view: PaidPanelView): TicketPaid {
  return {
    service: {
      category: view.category,
      marked_at: "",
      quote_requested_at: view.quoteRequestedAt,
      work_order: view.quoteId,
      quote_sent_at: view.sentAt,
      amount_cents: view.amountCents,
      accepted_at: view.acceptedAt,
      care_chosen_at: view.careChosenAt,
    },
    role: view.canChoose ? ctx.role : null,
    careUsage:
      view.care && view.care.onPlan
        ? {
            minutesLeft: view.care.minutesLeft,
            minutesIncluded: view.care.minutesIncluded,
            monthLabel: view.care.monthLabel,
          }
        : null,
  };
}

async function timeZoneOf(ctx: OrgContext): Promise<string> {
  try {
    return (await getBusinessProfile(ctx)).time_zone || "UTC";
  } catch {
    return "UTC";
  }
}

export default async function TicketPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { ctx } = await requireHubSession();
  const { number } = await params;
  const loaded = await load(ctx, number);
  if (loaded.kind === "missing") notFound();

  const back = (
    <GuardedLink href={TICKETS_HREF} className={BACK_LINK}>
      <ArrowLeft aria-hidden size={16} strokeWidth={2} />
      Tickets
    </GuardedLink>
  );

  if (loaded.kind === "error") {
    return (
      <div className="flex w-full flex-col gap-6 font-hub text-hub-ink">
        {back}
        <ScreenHeader
          title="Ticket"
          helpId={TICKET_HELP_ID}
          LinkComponent={GuardedLink}
        />
        <InlineAlert
          tone="error"
          action={
            <GuardedLink
              href={`/hub/support/tickets/${encodeURIComponent(number)}`}
              className={LINK}
            >
              {SUPPORT_UI_COPY.BUTTONS.tryAgain}
            </GuardedLink>
          }
        >
          {SUPPORT_UI_COPY.ERR_LOAD}
        </InlineAlert>
      </div>
    );
  }

  const access: SupportAccess = ctx.impersonator
    ? "impersonating"
    : can(ctx, "support", "write")
      ? "write"
      : "viewer";
  const timeZone = await timeZoneOf(ctx);
  const { ticket, page, lastReadAt } = loaded;
  const paid = loaded.paid ? paidProps(ctx, loaded.paid) : null;
  const rating = loaded.rating;

  return (
    <div
      className="flex w-full flex-col gap-4 font-hub text-hub-ink"
      data-ticket-detail={ticket.number}
    >
      {back}
      <div className="text-balance">
        <ScreenHeader
          title={ticket.subject}
          helpId={TICKET_HELP_ID}
          LinkComponent={GuardedLink}
        />
      </div>
      <TicketDetail
        ticket={ticket}
        firstReplyAt={ticket.firstRepliedAt}
        messages={page.messages}
        hasEarlier={page.hasEarlier}
        lastReadAt={lastReadAt}
        access={access}
        paid={paid}
        incident={loaded.incident}
        rating={
          rating ? (
            <TicketRating
              number={ticket.number}
              status={rating.status}
              rating={rating.rating}
              comment={rating.comment}
              canRate={rating.canRate}
              impersonating={Boolean(ctx.impersonator)}
            />
          ) : null
        }
        timeZone={timeZone}
        nowMs={Date.now()}
      />
    </div>
  );
}
