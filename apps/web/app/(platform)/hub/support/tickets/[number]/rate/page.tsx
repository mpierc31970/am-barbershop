// /hub/support/tickets/<n>/rate?t&r&e&sig (13-42 choice 3; STAFF-21, D212; 13-UI-SPEC lines
// 952-958; RESEARCH Pitfall 10; T-13-42-01, T-13-42-03). Where the Resolved email's one-tap
// rating links land. **GET renders only**: email scanners prefetch links, so this page never
// writes. It needs the hub session (signed out → the normal sign-in redirect), reads the ticket
// scoped to the session org, and checks the link with ratingLinkState (signature, purpose,
// expiry, and the link's thread id must be this ticket's). Then:
//   - valid + Resolved: the rating card in confirm mode, the link's choice pressed, an optional
//     comment and **Save rating** (a POST through the rating Server Action);
//   - valid + Closed: "This ticket is closed, so ratings are finished.";
//   - valid + any other status: "Only a resolved ticket can be rated.";
//   - expired, tampered or another ticket's link: the plain expired panel, with Open the
//     ticket (where the owner can still rate while it's Resolved).
// Impersonating staff get the read-only card (no write controls). Junk or another site's
// number is the hub 404, like the ticket page.
import { CdsError } from "@cds/core";
import { parseTicketNumber } from "@cds/core/support";
import {
  getTicketByNumber,
  ratingLinkState,
  ticketRatingView,
  type OrgContext,
  type TenantTicketDetail,
  type TicketRatingView,
} from "@cds/db";
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireHubSession } from "../../../../../../../lib/session";
import { GuardedLink } from "../../../../GuardedLink";
import { TicketRating } from "../TicketRating";

export const metadata: Metadata = {
  title: "Rate this ticket",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Not exported: a page module may export only Next's page fields.
const RATE_LINK_COPY = Object.freeze({
  title: "Rate this ticket",
  expiredTitle: "This rating link has expired",
  expired:
    "This rating link has expired. You can still rate on the ticket while it's resolved.",
  closed: "This ticket is closed, so ratings are finished.",
  notResolved: "Only a resolved ticket can be rated.",
  notRater:
    "Ratings come from the site's Owner, Admins, Editors and the person who opened the ticket.",
  openTicket: "Open the ticket",
  back: (n: number) => `Ticket #${n}`,
});
const C = RATE_LINK_COPY;

/** The "?" opens Follow a ticket, as on the ticket page (12-33). */
const TICKET_HELP_ID = "support.follow-ticket";

const BACK_LINK =
  "inline-flex items-center gap-1 self-start rounded text-sm font-semibold text-hub-accent " +
  "underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-hub-accent";

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

async function loadTicket(
  ctx: OrgContext,
  raw: string,
): Promise<TenantTicketDetail | null> {
  let n: number;
  try {
    n = parseTicketNumber(raw);
  } catch {
    return null;
  }
  try {
    return await getTicketByNumber(ctx, String(n));
  } catch (err) {
    if (
      err instanceof CdsError &&
      (err.code === "not_found" || err.code === "forbidden")
    ) {
      return null;
    }
    throw err;
  }
}

export default async function RateTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { ctx } = await requireHubSession();
  const { number } = await params;
  const sp: SearchParams = (await searchParams) ?? {};
  const ticket = await loadTicket(ctx, number);
  if (!ticket) notFound();

  const ticketHref = `/hub/support/tickets/${ticket.number}`;
  const t = one(sp.t);
  // The link must be this ticket's: a valid MAC for another thread is still refused.
  const state =
    t === ticket.id
      ? ratingLinkState(t, one(sp.r), one(sp.e), one(sp.sig), Date.now())
      : "invalid";

  const back = (
    <GuardedLink href={ticketHref} className={BACK_LINK}>
      <ArrowLeft aria-hidden size={16} strokeWidth={2} />
      {C.back(ticket.number)}
    </GuardedLink>
  );
  const openTicket = (
    <GuardedLink href={ticketHref} className={buttonClasses("secondary", "md")}>
      {C.openTicket}
    </GuardedLink>
  );

  if (state !== "valid") {
    return (
      <div
        className="flex w-full flex-col gap-4 font-hub text-hub-ink"
        data-rate-link="expired"
      >
        {back}
        <div className="flex max-w-[480px] flex-col gap-4 rounded-lg border border-hub-border bg-hub-surface p-6">
          <h1 className="text-[1.75rem] leading-tight font-semibold">
            {C.expiredTitle}
          </h1>
          <p className="text-base text-hub-ink-muted">{C.expired}</p>
          <div>{openTicket}</div>
        </div>
      </div>
    );
  }

  const choice = one(sp.r) === "down" ? "down" : "up";
  let view: TicketRatingView | null = null;
  try {
    view = await ticketRatingView(ctx, ticket.number);
  } catch (err) {
    console.error(`[hub] rating link read failed ${errName(err)}`);
  }
  const status = view?.status ?? ticket.status;
  const impersonating = Boolean(ctx.impersonator);

  let body: ReactNode;
  if (status === "closed") {
    body = (
      <InlineAlert tone="info" action={openTicket}>
        {C.closed}
      </InlineAlert>
    );
  } else if (status !== "resolved" || !view) {
    body = (
      <InlineAlert tone="info" action={openTicket}>
        {view ? C.notResolved : C.expired}
      </InlineAlert>
    );
  } else if (!view.canRate && !impersonating) {
    body = (
      <InlineAlert tone="info" action={openTicket}>
        {C.notRater}
      </InlineAlert>
    );
  } else {
    body = (
      <TicketRating
        number={ticket.number}
        status={status}
        rating={view.rating}
        comment={view.comment}
        canRate={view.canRate}
        impersonating={impersonating}
        preselect={impersonating ? null : choice}
      />
    );
  }

  return (
    <div
      className="flex w-full flex-col gap-4 font-hub text-hub-ink"
      data-rate-link={state}
    >
      {back}
      <div className="text-balance">
        <ScreenHeader
          title={ticket.subject}
          helpId={TICKET_HELP_ID}
          LinkComponent={GuardedLink}
        />
      </div>
      <div className="max-w-[640px]">{body}</div>
    </div>
  );
}
