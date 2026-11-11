// /staff/tickets/<number> (13-35 choice 3; STAFF-05, STAFF-08, STAFF-20; 13-UI-SPEC "Ticket
// detail"): a ticket of any site on its own page (phones, links, "Open on its own page").
// requireStaff("support_read"); the path segment is parsed ("1042" and "#1042", i.e. "%231042"),
// then read with staffGetTicket (the support:show read: every message, internal notes
// included). Junk and unknown numbers → notFound() ("No ticket #1042." + Back to the inbox);
// any other failure shows ERR-LOAD + Try again (class name logged only). The composer slot is
// left empty for 13-41.
import { CdsError } from "@cds/core";
import { staffGetTicket, type StaffTicketDetail } from "@cds/db";
import { STAFF_TICKETS_COPY } from "@cds/ui/staff";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "../../../../../../lib/staff-session";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { TicketDetail } from "../TicketDetail";
import { ticketDetailData, ticketNumberFromSegment } from "../ticket-data";

export const metadata: Metadata = { title: "Ticket" };

export const dynamic = "force-dynamic";

const BACK =
  "inline-flex items-center gap-1 self-start rounded text-sm font-semibold text-hub-accent " +
  "underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-hub-accent";

export default async function StaffTicketPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const session = await requireStaff("support_read");
  const { number: raw } = await params;
  const number = ticketNumberFromSegment(raw);
  if (number === null) notFound();

  const now = new Date();
  let ticket: StaffTicketDetail;
  try {
    ticket = await staffGetTicket(session.ctx, number, { now });
  } catch (err) {
    if (err instanceof CdsError && err.code === "not_found") notFound();
    console.error(
      "[staff tickets] ticket read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return (
      <div className="flex flex-col gap-4">
        <Link href="/staff/tickets?tab=inbox" className={BACK}>
          <ArrowLeft aria-hidden size={16} strokeWidth={2} />
          {STAFF_TICKETS_COPY.backToInbox}
        </Link>
        <SitesLoadError href={`/staff/tickets/${number}`} />
      </div>
    );
  }
  const data = await ticketDetailData(session, ticket, { now });
  return (
    <div className="flex w-full flex-col gap-4">
      <Link href="/staff/tickets?tab=inbox" className={BACK}>
        <ArrowLeft aria-hidden size={16} strokeWidth={2} />
        {STAFF_TICKETS_COPY.backToInbox}
      </Link>
      <TicketDetail data={data} />
    </div>
  );
}
