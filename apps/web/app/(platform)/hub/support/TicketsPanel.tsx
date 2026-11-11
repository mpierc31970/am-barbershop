"use client";
// Tickets tab (12-25 choice 1; COMM-06, COMM-07, SUPPORT-01, D211; 12-UI-SPEC Tickets lines
// 355-372). The client island under the server loader in page.tsx:
//   - Heading "Your tickets" + SegmentedControl Open · Closed · All (`?show=` link-state; the
//     loader reads every ticket once, so switching is instant and the URL is replaced).
//   - TicketList keeps the server order (Waiting on you first, then newest activity).
//   - Empty (no open tickets): TICKETS-EMPTY with the Get help link for writers; Viewers and
//     impersonating staff get the heading and body without the link.
//   - "Your support" panel, Owner only (billing:read; the loader passes null to everyone
//     else, T-12-25-03): "Support · Included in your plan" + What support includes, and the
//     P11 Care Plan row (moved here from the interim page) or "Not on your plan" + About the
//     Care Plan. The loader in page.tsx reads carePlanUsage; this island renders the row. A
//     failed Care read drops only that row.
import type { TenantTicket } from "@cds/core/support";
import { EmptyState, SegmentedControl } from "@cds/ui/hub";
import {
  SUPPORT_UI_COPY,
  TicketList,
  filterTickets,
  type TicketListShow,
} from "@cds/ui/hub/support";
import { useId, useState } from "react";
import { GuardedLink } from "../GuardedLink";
import type { SupportAccess } from "./SupportFrame";
import {
  BILLING_HREF,
  CARE_PANEL_HREF,
  SUPPORT_COPY,
  WHAT_SUPPORT_INCLUDES_HREF,
  getHelpHref,
} from "./support-copy";

/** The Owner's Care Plan row: on with the usage line, off, or unreadable (row dropped). */
export type CareRow = { on: true; line: string } | { on: false } | null;

export interface TicketsPanelProps {
  tickets: TenantTicket[];
  show: TicketListShow;
  access: SupportAccess;
  /** Server clock (epoch ms) for "Updated 2 hours ago", so server and client agree. */
  nowMs: number;
  /** Owner only; null hides the Your support panel. */
  support: { care: CareRow } | null;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

const SHOW_OPTIONS: { value: TicketListShow; label: string }[] = [
  { value: "open", label: SUPPORT_COPY.ticketsShow.open },
  { value: "closed", label: SUPPORT_COPY.ticketsShow.closed },
  { value: "all", label: SUPPORT_COPY.ticketsShow.all },
];

/** Replaces `?show=` without a server round trip (the list is already loaded). */
function replaceShow(show: TicketListShow): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "tickets");
    if (show === "open") url.searchParams.delete("show");
    else url.searchParams.set("show", show);
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // Link-state is a convenience; the filter still applies.
  }
}

function YourSupport({ care }: { care: CareRow }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-hub-border p-6"
      data-your-support=""
    >
      <h2 id={headingId} className="text-xl leading-tight font-semibold">
        {SUPPORT_COPY.yourSupport}
      </h2>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-base sm:grid-cols-[max-content_1fr]">
        <dt className="text-hub-ink-muted">{SUPPORT_COPY.supportRow}</dt>
        <dd className="flex min-w-0 flex-wrap gap-x-3">
          <span>{SUPPORT_COPY.supportIncluded}</span>
          <GuardedLink href={WHAT_SUPPORT_INCLUDES_HREF} className={LINK}>
            {SUPPORT_UI_COPY.BUTTONS.whatSupportIncludes}
          </GuardedLink>
        </dd>
        {care ? (
          <>
            <dt className="text-hub-ink-muted">{SUPPORT_COPY.care}</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-3" data-support-care="">
              <span>{care.on ? care.line : SUPPORT_COPY.careOff}</span>
              <GuardedLink
                href={care.on ? BILLING_HREF : CARE_PANEL_HREF}
                className={LINK}
              >
                {care.on ? SUPPORT_COPY.billingLink : SUPPORT_COPY.aboutCare}
              </GuardedLink>
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

export function TicketsPanel({
  tickets,
  show: initialShow,
  access,
  nowMs,
  support,
}: TicketsPanelProps) {
  const headingId = useId();
  const [show, setShow] = useState<TicketListShow>(initialShow);
  const canWrite = access === "write";
  const openEmpty =
    show !== "closed" && filterTickets(tickets, show).length === 0;

  return (
    <div className="flex flex-col gap-8" data-tickets-panel="">
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id={headingId} className="text-xl leading-tight font-semibold">
            {SUPPORT_COPY.ticketsHeading}
          </h2>
          <div className="w-full sm:w-fit">
            <SegmentedControl<TicketListShow>
              name="tickets-show"
              label={SUPPORT_COPY.ticketsShowLabel}
              options={SHOW_OPTIONS}
              value={show}
              onChange={(v) => {
                setShow(v);
                replaceShow(v);
              }}
            />
          </div>
        </div>
        {openEmpty && !canWrite ? (
          <EmptyState
            heading={SUPPORT_UI_COPY.TICKETS_EMPTY_H}
            body={SUPPORT_COPY.ticketsEmptyReadOnly}
          />
        ) : (
          <TicketList
            tickets={tickets}
            show={show}
            now={nowMs}
            LinkComponent={GuardedLink}
            newTicketHref={getHelpHref("/hub/support?tab=tickets")}
          />
        )}
      </section>
      {support ? <YourSupport care={support.care} /> : null}
    </div>
  );
}
