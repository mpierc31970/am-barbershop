// Panel tickets/inbox: filled by 13-35
// Panel tickets/inbox (13-35 choice 2; STAFF-05, STAFF-20; D82, D92, D211; 13-UI-SPEC "Ticket
// inbox" lines 378-425). One inbox across every site. URL params → parseInboxParams →
// toStaffListInput(params, me) → staffListTickets (the support:list read) → refineInboxRows
// (number / subject / priority / assignee / waiting refinements + SLA → priority → age sort) →
// inboxPage (50, "Show 50 more"). A second read (status all) feeds the Assignee and Site
// options. `?open=<n>` renders that ticket (staffGetTicket) in the split pane beside the list
// (≥ 1024px); an unknown number simply opens nothing. A failed list read shows ERR-LOAD + Try
// again (class name logged only).
import { CdsError } from "@cds/core";
import {
  hasInboxFilters,
  inboxPage,
  inboxParamsToSearch,
  parseInboxParams,
  refineInboxRows,
  toStaffListInput,
  type InboxParams,
  type InboxSort,
} from "@cds/core/staff";
import {
  TICKET_STATUSES,
  TICKET_TYPES,
  type TicketStatus,
} from "@cds/core/support";
import { staffGetTicket, staffListTickets, type StaffTicketRow } from "@cds/db";
import { ticketTypeShort } from "@cds/ui/hub/support";
import {
  STAFF_TABLE_COPY,
  STAFF_TICKETS_COPY as C,
  inboxHref,
  staffStatusLabel,
  type FilterField,
  type InboxRowView,
  type QuickFilterItem,
} from "@cds/ui/staff";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { InboxIsland } from "../InboxIsland";
import { TicketDetail } from "../TicketDetail";
import {
  allTicketRows,
  staffOptionsFrom,
  ticketDetailData,
  ticketNumberFromSegment,
  type TicketDetailData,
} from "../ticket-data";

const QUICK: readonly (InboxParams["quick"] | undefined)[] = [
  "mine",
  "unassigned",
  "at-risk",
  "waiting",
  undefined,
];
const SORTS: readonly InboxSort[] = ["sla", "priority", "age"];
const PRIORITY_ORDER = ["urgent", "high", "normal", "low"] as const;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function hrefOf(p: InboxParams): string {
  return inboxHref(inboxParamsToSearch(p));
}

function toRow(r: StaffTicketRow, now: Date): InboxRowView {
  return {
    number: r.number,
    orgId: r.orgId,
    orgName: r.orgName,
    type: r.type,
    subject: r.subject,
    status: r.status,
    priority: r.priority,
    created: new Date(now.getTime() - r.ageMs).toISOString(),
    sla: r.sla,
    dueAt: r.dueAt,
    assignee: r.assignee,
    assigneeId: r.assigneeId,
    openedByCds: r.openedByCds,
  };
}

function filterFields(
  p: InboxParams,
  options: { staff: { id: string; name: string }[]; sites: [string, string][] },
  meId: string,
): FilterField[] {
  return [
    {
      name: "type",
      label: C.filters.type,
      value: p.type ?? "",
      options: TICKET_TYPES.map((t) => ({
        value: t,
        label: ticketTypeShort(t),
      })),
    },
    {
      name: "status",
      label: C.filters.status,
      value: p.status ?? "",
      options: [
        ...TICKET_STATUSES.map((s: TicketStatus) => ({
          value: s,
          label: staffStatusLabel(s),
        })),
        { value: "all", label: C.statusAll },
      ],
    },
    {
      name: "priority",
      label: C.filters.priority,
      value: p.priority ?? "",
      options: PRIORITY_ORDER.map((v) => ({
        value: v,
        label: STAFF_TABLE_COPY.priority[v],
      })),
    },
    {
      name: "assignee",
      label: C.filters.assignee,
      value: p.assignee ?? "",
      options: [
        { value: "me", label: C.me("") },
        { value: "none", label: C.unassigned },
        ...options.staff
          .filter((s) => s.id !== meId)
          .map((s) => ({ value: s.id, label: s.name })),
      ],
    },
    {
      name: "org",
      label: C.filters.org,
      value: p.org ?? "",
      options: options.sites.map(([id, name]) => ({
        value: id,
        label: name || id,
      })),
    },
  ];
}

export default async function Panel({ session, params }: StaffPanelProps) {
  const p = parseInboxParams(params);
  const now = new Date();
  const me = session.ctx.actor;
  const query = toStaffListInput(p, me);
  let listed: StaffTicketRow[];
  let all: StaffTicketRow[];
  try {
    [listed, all] = await Promise.all([
      staffListTickets(session.ctx, { ...query.list, now }),
      allTicketRows(session, now),
    ]);
  } catch (err) {
    console.error("[staff tickets] inbox read failed", errName(err));
    return <SitesLoadError href={hrefOf(p)} />;
  }
  const refined = refineInboxRows(listed, query);
  const shown = inboxPage(refined, query.page);
  const atRisk = refined.filter((r) => r.sla === "due_soon").length;
  const missed = refined.filter((r) => r.sla === "missed").length;

  const staff = staffOptionsFrom(all, session);
  const sites = [
    ...new Map(
      all.map((r) => [r.orgId, r.orgName] as [string, string]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const quickFilters: QuickFilterItem[] = QUICK.map((q) => ({
    id: q ?? "all",
    label: C.quick[q ?? "all"],
    href: hrefOf({ ...p, quick: q, page: undefined }),
    pressed: p.quick === q,
  }));
  const sortHrefs = Object.fromEntries(
    SORTS.map((s) => [s, hrefOf({ ...p, sort: s, page: undefined })]),
  );

  // Split pane: ?open=<n>.
  const openNumber = ticketNumberFromSegment(one(params.open));
  let detail: TicketDetailData | null = null;
  if (openNumber !== null) {
    try {
      const t = await staffGetTicket(session.ctx, openNumber, { now });
      detail = await ticketDetailData(session, t, { now, rows: all });
    } catch (err) {
      if (!(err instanceof CdsError && err.code === "not_found")) {
        console.error("[staff tickets] split read failed", errName(err));
      }
      detail = null;
    }
  }

  const listSearch = inboxParamsToSearch(p);
  const empty =
    refined.length > 0 ? null : hasInboxFilters(p) ? "filtered" : "none";
  return (
    <InboxIsland
      rows={shown.map((r) => toRow(r, now))}
      now={now.toISOString()}
      resultLine={C.resultLine(refined.length, atRisk, missed)}
      quickFilters={quickFilters}
      filters={filterFields(p, { staff, sites }, me)}
      search={p.q ?? ""}
      listSearch={listSearch}
      sort={query.sort}
      sortHrefs={sortHrefs}
      empty={empty}
      clearHref={inboxHref("")}
      moreHref={
        shown.length < refined.length
          ? hrefOf({ ...p, page: query.page + 1 })
          : null
      }
      openNumber={detail ? detail.number : null}
      detail={
        detail ? (
          <TicketDetail
            key={detail.number}
            data={detail}
            split
            closeHref={inboxHref(listSearch)}
          />
        ) : undefined
      }
      staff={staff}
    />
  );
}
