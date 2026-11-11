// Panel sites/[org]/support: filled by 13-33
// Panel sites/[org]/support (13-33 choice 3; STAFF-02, STAFF-05; 13-UI-SPEC site detail
// "Support" line 790). This site's tickets (`staffListTickets({ orgId, status: "all" })`, the
// support:list read, most urgent first) linking to /staff/tickets/<n>. "Open ticket for this
// site" is a link to the Actions tab, where 13-43's dialog lives; the CDS post dialog is 13-43
// too. Needs support_read (the tab feature, checked by the page).
import { staffListTickets, type StaffTicketRow } from "@cds/db";
import { buttonClasses } from "@cds/ui/hub";
import {
  SITES_COPY,
  SiteTicketsTable,
  type SiteTicketRowView,
} from "@cds/ui/staff";
import type { StaffSitePanelProps } from "../../../StaffAreaPage";
import { SitesLoadError } from "../../SitesLoadError";

export function siteTicketRows(
  rows: readonly StaffTicketRow[],
): SiteTicketRowView[] {
  return rows.map((t) => ({
    number: t.number,
    subject: t.subject,
    type: t.type,
    status: t.status,
    priority: t.priority,
    sla: t.sla,
    dueAt: t.dueAt,
    assignee: t.assignee,
  }));
}

export default async function Panel({ session, orgId }: StaffSitePanelProps) {
  let rows: StaffTicketRow[];
  const now = new Date();
  try {
    rows = await staffListTickets(session.ctx, { orgId, status: "all", now });
  } catch (err) {
    console.error(
      "[staff] site tickets failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href={`/staff/sites/${orgId}?tab=support`} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <a
          href={`/staff/sites/${orgId}?tab=actions`}
          className={buttonClasses("secondary", "sm")}
        >
          {SITES_COPY.tickets.openTicket}
        </a>
      </div>
      <SiteTicketsTable
        rows={siteTicketRows(rows.filter((t) => t.orgId === orgId))}
        now={now.toISOString()}
      />
    </div>
  );
}
