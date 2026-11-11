// ClosedTicketPanel (12-10; COMM-09, D95; 12-UI-SPEC ticket detail line 446-448). In place of
// the composer on a Closed ticket: CLOSED-NOTE and a secondary "Open a new ticket" link to
// /hub/support/tickets/new?target=<same>&type=<same>&ref=<number>. The form prefills type and
// target and starts Tell us more with "Follows up on ticket #1042.". Server-safe: no hooks.
import type { TenantTicket } from "@cds/core/support";
import type { HubLinkComponent } from "../../AddonCard";
import { buttonClasses } from "../../Button";
import { SUPPORT_UI_COPY } from "../copy";
import { followUpHref } from "./copy";

export interface ClosedTicketPanelProps {
  ticket: Pick<TenantTicket, "number" | "type" | "target">;
  LinkComponent?: HubLinkComponent;
}

export function ClosedTicketPanel({
  ticket,
  LinkComponent,
}: ClosedTicketPanelProps) {
  const Link = LinkComponent ?? "a";
  return (
    <div
      className="mt-12 flex flex-col items-start gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink"
      data-closed-ticket=""
    >
      <p className="text-base">{SUPPORT_UI_COPY.CLOSED_NOTE}</p>
      <Link href={followUpHref(ticket)} className={buttonClasses("secondary")}>
        {SUPPORT_UI_COPY.BUTTONS.openNewTicket}
      </Link>
    </div>
  );
}
