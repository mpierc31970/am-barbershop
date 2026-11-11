// Panel tickets/incidents: filled by 13-36
// Panel tickets/incidents (13-36 choices 3-4; STAFF-12, D103; 13-UI-SPEC "Incidents" lines
// 540-556). `?view=open|resolved|all` (default open) over staffListIncidents (the CLI's list);
// `?open=I-3` also reads that incident's linked tickets (staffIncidentTickets) and opens the
// detail drawer. The tab itself is gated on `incident_run` (STAFF_SECTIONS). A failed read logs
// the class name only.
import {
  staffIncidentTickets,
  staffListIncidents,
  type StaffIncidentRow,
  type StaffIncidentTicket,
} from "@cds/db";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import {
  IncidentDrawer,
  IncidentsList,
  type IncidentRowView,
  type IncidentsView,
} from "../IncidentsIsland";

const INCIDENT_RE = /^I-[1-9]\d{0,8}$/i;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function toView(r: StaffIncidentRow): IncidentRowView {
  return {
    code: r.code,
    title: r.title,
    publicText: r.publicText,
    status: r.status,
    linked: r.linked,
    sites: r.sites,
    created: r.created,
    resolvedAt: r.resolvedAt,
  };
}

export default async function Panel({ session, params }: StaffPanelProps) {
  const rawView = one(params.view);
  const view: IncidentsView =
    rawView === "resolved" || rawView === "all" ? rawView : "open";
  const href =
    view === "open"
      ? "/staff/tickets?tab=incidents"
      : `/staff/tickets?tab=incidents&view=${view}`;
  let all: StaffIncidentRow[];
  try {
    all = await staffListIncidents(session.ctx, { includeResolved: true });
  } catch (err) {
    console.error("[staff] incidents read failed", errName(err));
    return <SitesLoadError href={href} />;
  }
  const rows = all
    .filter((r) => view === "all" || r.status === view)
    .map(toView);
  const openCode = one(params.open).toUpperCase();
  const opened = INCIDENT_RE.test(openCode)
    ? all.find((r) => r.code === openCode)
    : undefined;
  let tickets: StaffIncidentTicket[] = [];
  if (opened) {
    try {
      tickets = await staffIncidentTickets(session.ctx, opened.code);
    } catch (err) {
      console.error("[staff] incident tickets read failed", errName(err));
      return <SitesLoadError href={href} />;
    }
  }
  const now = new Date().toISOString();
  return (
    <>
      <IncidentsList rows={rows} view={view} now={now} />
      {opened ? (
        <IncidentDrawer
          key={opened.code}
          incident={toView(opened)}
          tickets={tickets.map((t) => ({
            number: t.number,
            business: t.business,
            subject: t.subject,
            status: t.status,
            created: t.created,
          }))}
          view={view}
          now={now}
        />
      ) : null}
    </>
  );
}
