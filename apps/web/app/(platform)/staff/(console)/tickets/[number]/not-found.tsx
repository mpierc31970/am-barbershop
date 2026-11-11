// Console 404 for /staff/tickets/<number> (13-35; 13-UI-SPEC "Ticket detail": "No ticket
// #1042." + Back to the inbox). Not-found pages get no params, so the number comes from the
// request path the middleware records (x-cds-path); anything unreadable says "No ticket." The
// path is shown as text only.
import { STAFF_TICKETS_COPY } from "@cds/ui/staff";
import { headers } from "next/headers";
import Link from "next/link";
import { PATH_HEADER } from "../../../../../../lib/path-header";
import { ticketSegmentOf } from "../ticket-data";

const LINK =
  "rounded font-semibold text-hub-accent underline underline-offset-2 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export default async function TicketNotFound() {
  const seg = ticketSegmentOf((await headers()).get(PATH_HEADER));
  return (
    <div className="flex flex-col items-start gap-3 py-12 font-hub text-hub-ink">
      <h1 className="text-2xl font-semibold">
        {seg
          ? STAFF_TICKETS_COPY.notFound(seg)
          : STAFF_TICKETS_COPY.notFoundUnknown}
      </h1>
      <Link href="/staff/tickets?tab=inbox" className={LINK}>
        {STAFF_TICKETS_COPY.backToInbox}
      </Link>
    </div>
  );
}
