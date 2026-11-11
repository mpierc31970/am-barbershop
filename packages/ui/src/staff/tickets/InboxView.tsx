"use client";
// InboxView (13-35 choice 2; STAFF-05, STAFF-20; D82, D92, D119, D211; 13-UI-SPEC "Ticket
// inbox" lines 378-425, a11y 1095-1102, responsive 1124-1127). The client island over
// server-read rows (one inbox across every site):
//   - FilterBar (GET form: search "1042" / "#1042" / subject, Type · Status · Priority ·
//     Assignee · Site selects, Clear filters, the polite result line "12 tickets · 2 at risk ·
//     1 missed" + "2 new tickets" after a refresh) with QuickFilters (Mine · Unassigned · At risk
//     · Waiting on CDS · All open) leading it. Every filter is a URL param.
//   - StaffTable: # · Site · Type · Subject · Status ("Waiting on owner") · Priority · Assignee
//     · Age · SLA; SLA / Priority / Age headers sort (URL param); bulk checkboxes.
//   - Bulk bar (sticky, ≥ 1 checked): "3 selected" · Assign to · Priority · Status · Clear
//     selection. Assign and priority apply at once with an Undo toast (8 s) that puts each
//     ticket back; Waiting on owner / Resolved open the bulk CaseDialog first ("Set 3 tickets
//     to Resolved? Owners of 2 sites get an alert."); other statuses apply at once.
//   - Split view ≥ 1024px: a row click opens the ticket beside the list (`?open=1042`, pushed so
//     Back closes it; Esc closes it too) and the list turns into compact two-line rows. Below
//     1024px (or without JS) the row link opens /staff/tickets/<n>.
//   - Empty: INBOX-EMPTY; filters with no match: "No tickets match these filters." + Clear.
// Rows are plain data (client code never imports @cds/db); subjects stay React text.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { fillCopy, P13_COPY, P13_DIALOGS } from "@cds/core/staff";
import type {
  Priority,
  SlaState,
  TicketStatus,
  TicketType,
} from "@cds/core/support";
import { Inbox } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Badge } from "../../hub/Badge";
import { EmptyState } from "../../hub/feedback";
import { useToast } from "../../hub/Toast";
import { SUPPORT_UI_COPY } from "../../hub/support/copy";
import {
  ticketStatusTone,
  ticketTypeShort,
} from "../../hub/support/tickets/copy";
import { CaseDialog, useStaffAction, type StaffActionResult } from "../dialogs";
import {
  AgeCell,
  FilterBar,
  PriorityCell,
  QuickFilters,
  STAFF_TABLE_COPY,
  SlaCell,
  StaffTable,
  compactAge,
  type FilterField,
  type QuickFilterItem,
  type StaffColumn,
} from "../table";
import { STAFF_TICKETS_COPY as C, staffStatusLabel } from "./copy";
import { inboxHref } from "./inbox-href";
import type { StaffOption } from "./TicketRail";

export interface InboxRowView {
  number: number;
  orgId: string;
  orgName: string;
  type: TicketType;
  subject: string;
  status: TicketStatus;
  priority: Priority;
  /** ISO creation time (Age). */
  created: string;
  sla: SlaState;
  dueAt: string | null;
  assignee: string | null;
  assigneeId: string | null;
  openedByCds: boolean;
}

export type InboxBulkInput =
  | { numbers: number[]; assign: string }
  | { numbers: number[]; priority: Priority }
  | { numbers: number[]; status: TicketStatus };

export interface InboxBulkResult {
  message: string;
  changed: number;
  alerted: number;
  failed: { number: number; message: string }[];
}

export interface InboxViewProps {
  rows: readonly InboxRowView[];
  /** ISO time of the read. */
  now: string;
  /** "12 tickets · 2 at risk · 1 missed". */
  resultLine: string;
  quickFilters: readonly QuickFilterItem[];
  filters: readonly FilterField[];
  search: string;
  /** Current list query (no "?", no `open`), from inboxParamsToSearch. */
  listSearch: string;
  sort: "sla" | "priority" | "age";
  /** Href per sortable column id (sla, priority, age). */
  sortHrefs: Readonly<Record<string, string>>;
  /** No open tickets at all vs filters with no match. */
  empty: "none" | "filtered" | null;
  clearHref: string;
  moreHref: string | null;
  /** Ticket open in the split pane. */
  openNumber: number | null;
  /** The split-pane ticket (server-rendered TicketDetail). */
  detail?: ReactNode;
  staff: readonly StaffOption[];
  onBulk: (
    input: InboxBulkInput,
  ) => Promise<StaffActionResult<InboxBulkResult>>;
  /** Client navigation (router.push); defaults to location.assign. */
  onNavigate?: (href: string) => void;
  shortcutsEnabled?: boolean;
  timeZone?: string;
}

const BULK_STATUSES: readonly TicketStatus[] = [
  "in_progress",
  "waiting_on_you",
  "resolved",
  "closed",
];
const ALERTING: readonly TicketStatus[] = ["waiting_on_you", "resolved"];
const PRIORITIES: readonly Priority[] = ["urgent", "high", "normal", "low"];
const SPLIT_QUERY = "(min-width: 1024px)";

const SELECT =
  "h-8 rounded border border-hub-border-strong bg-hub-surface px-2 font-hub text-sm " +
  "text-hub-ink pointer-coarse:h-11 disabled:opacity-60 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";
const GHOST =
  "inline-flex h-8 items-center rounded px-3 font-hub text-sm font-semibold text-hub-ink " +
  "hover:bg-hub-surface pointer-coarse:min-h-11 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";
const LINK =
  "rounded text-hub-accent underline-offset-2 hover:underline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  );
}

function wideEnough(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(SPLIT_QUERY).matches
    );
  } catch {
    return false;
  }
}

export function InboxView({
  rows,
  now,
  resultLine,
  quickFilters,
  filters,
  search,
  listSearch,
  sort,
  sortHrefs,
  empty,
  clearHref,
  moreHref,
  openNumber,
  detail,
  staff,
  onBulk,
  onNavigate,
  shortcutsEnabled = true,
  timeZone = BUSINESS_TIME_ZONE,
}: InboxViewProps) {
  const toast = useToast();
  const runBulk = useStaffAction(onBulk);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<TicketStatus | null>(null);
  const [newCount, setNewCount] = useState(0);
  const seen = useRef<Set<number> | null>(null);
  const at = new Date(now);
  const ref = Number.isNaN(at.getTime()) ? new Date() : at;
  const split = openNumber !== null && detail !== undefined;

  const navigate = (href: string) =>
    onNavigate ? onNavigate(href) : window.location.assign(href);

  // "2 new tickets" after a refresh brought rows the list had not shown. The baseline belongs
  // to one list query (filters, sort and page are all in listSearch): a different query is a
  // new list, never "new tickets" (WR-E05).
  const seenFor = useRef<string | null>(null);
  useEffect(() => {
    const numbers = new Set(rows.map((r) => r.number));
    if (seen.current && seenFor.current === listSearch) {
      let fresh = 0;
      for (const n of numbers) if (!seen.current.has(n)) fresh += 1;
      setNewCount(fresh);
    } else {
      setNewCount(0);
    }
    seen.current = numbers;
    seenFor.current = listSearch;
    setSelected((s) => s.filter((k) => numbers.has(Number(k))));
  }, [rows, listSearch]);

  // Esc closes the split pane (focus returns to the list via the navigation).
  useEffect(() => {
    if (!split) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isTextTarget(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      navigate(inboxHref(listSearch));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const byNumber = useMemo(
    () => new Map(rows.map((r) => [String(r.number), r])),
    [rows],
  );
  const chosen = selected
    .map((k) => byNumber.get(k))
    .filter((r): r is InboxRowView => r !== undefined);

  async function apply(
    input: InboxBulkInput,
    undo?: () => Promise<void>,
  ): Promise<StaffActionResult<InboxBulkResult>> {
    setPending(true);
    let r: StaffActionResult<InboxBulkResult>;
    try {
      r = await runBulk(input);
    } catch {
      r = { ok: false, code: "unavailable", message: SUPPORT_UI_COPY.ERR_SAVE };
    }
    setPending(false);
    if (r.ok) {
      setSelected([]);
      toast.show({
        message: r.data.message,
        ...(undo && r.data.changed > 0
          ? { action: { label: P13_COPY.UNDO, onClick: () => void undo() } }
          : {}),
      });
    } else if (r.code !== "session_ended") {
      toast.show({ message: SUPPORT_UI_COPY.ERR_SAVE });
    }
    return r;
  }

  /** Put each ticket back to its own previous value (one bulk call per value). */
  function undoer<K extends "assign" | "priority">(
    key: K,
    prior: readonly InboxRowView[],
  ): () => Promise<void> {
    return async () => {
      const groups = new Map<string, number[]>();
      for (const r of prior) {
        const v = key === "assign" ? (r.assigneeId ?? "none") : r.priority;
        groups.set(v, [...(groups.get(v) ?? []), r.number]);
      }
      for (const [v, numbers] of groups) {
        const input =
          key === "assign"
            ? { numbers, assign: v }
            : { numbers, priority: v as Priority };
        let r: StaffActionResult<InboxBulkResult>;
        try {
          r = await runBulk(input);
        } catch {
          r = { ok: false, code: "unavailable", message: "" };
        }
        // WR-E06: a refused call or a ticket that failed is never reported as undone.
        if (!r.ok || r.data.failed.length > 0) {
          if (r.ok || r.code !== "session_ended") {
            toast.show({ message: SUPPORT_UI_COPY.ERR_SAVE });
          }
          return;
        }
      }
      toast.show({ message: C.undone });
    };
  }

  function onAssign(v: string) {
    if (!v || chosen.length === 0) return;
    const prior = [...chosen];
    void apply(
      { numbers: prior.map((r) => r.number), assign: v },
      undoer("assign", prior),
    );
  }
  function onPriority(v: string) {
    if (!v || chosen.length === 0) return;
    const prior = [...chosen];
    void apply(
      { numbers: prior.map((r) => r.number), priority: v as Priority },
      undoer("priority", prior),
    );
  }
  function onStatus(v: string) {
    if (!v || chosen.length === 0) return;
    const to = v as TicketStatus;
    if (ALERTING.includes(to)) {
      setConfirm(to);
      return;
    }
    void apply({ numbers: chosen.map((r) => r.number), status: to });
  }

  function onPrimaryClick(row: InboxRowView, e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (!wideEnough()) return;
    e.preventDefault();
    navigate(inboxHref(listSearch, row.number));
  }

  const fullColumns: StaffColumn<InboxRowView>[] = [
    {
      id: "number",
      header: C.cols.number,
      priority: 1,
      primary: true,
      nowrap: true,
      width: "72px",
      cell: (r) => C.ticketRef(r.number),
    },
    {
      id: "site",
      header: C.cols.site,
      priority: 3,
      width: "160px",
      cell: (r) => (
        <a
          href={`/staff/sites/${encodeURIComponent(r.orgId)}`}
          className={`${LINK} text-sm text-hub-ink-muted`}
        >
          {r.orgName || r.orgId}
        </a>
      ),
    },
    {
      id: "type",
      header: C.cols.type,
      priority: 4,
      width: "96px",
      cell: (r) => ticketTypeShort(r.type),
    },
    {
      id: "subject",
      header: C.cols.subject,
      priority: 1,
      stack: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate" title={r.subject}>
              {r.subject}
            </span>
            {r.priority === "urgent" || r.priority === "high" ? (
              <span className="xl:hidden">
                <PriorityCell priority={r.priority} />
              </span>
            ) : null}
          </span>
          <span className="text-sm text-hub-ink-muted lg:hidden">
            {r.orgName || r.orgId}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      header: C.cols.status,
      priority: 1,
      stack: true,
      nowrap: true,
      width: "136px",
      cell: (r) => (
        <Badge tone={ticketStatusTone(r.status)}>
          {staffStatusLabel(r.status)}
        </Badge>
      ),
    },
    {
      id: "priority",
      header: C.cols.priority,
      priority: 4,
      sortable: true,
      width: "96px",
      cell: (r) => <PriorityCell priority={r.priority} />,
    },
    {
      id: "assignee",
      header: C.cols.assignee,
      priority: 4,
      width: "96px",
      cell: (r) => r.assignee ?? C.none,
    },
    {
      id: "age",
      header: C.cols.age,
      priority: 1,
      sortable: true,
      stack: true,
      nowrap: true,
      width: "56px",
      cell: (r) => <AgeCell from={r.created} now={ref} tz={timeZone} />,
    },
    {
      id: "sla",
      header: C.cols.sla,
      priority: 1,
      sortable: true,
      stack: true,
      nowrap: true,
      width: "128px",
      cell: (r) => (
        <SlaCell state={r.sla} dueAt={r.dueAt} now={ref} tz={timeZone} />
      ),
    },
  ];

  const compactColumns: StaffColumn<InboxRowView>[] = [
    {
      id: "ticket",
      header: C.cols.ticket,
      priority: 1,
      primary: true,
      cell: (r) => {
        const d = new Date(r.created.replace(" ", "T"));
        const age = Number.isNaN(d.getTime())
          ? ""
          : ` · ${compactAge(d, ref, timeZone)}`;
        return (
          <span className="flex min-w-0 flex-col">
            <span className="tabular-nums">{`${C.ticketRef(r.number)} · ${r.orgName || r.orgId}${age}`}</span>
            <span
              className="truncate font-normal text-hub-ink"
              title={r.subject}
            >
              {r.subject}
            </span>
          </span>
        );
      },
    },
    {
      id: "state",
      header: C.cols.status,
      priority: 1,
      stack: true,
      align: "end",
      cell: (r) => (
        <span className="flex flex-col items-end gap-1">
          <Badge tone={ticketStatusTone(r.status)}>
            {staffStatusLabel(r.status)}
          </Badge>
          <SlaCell state={r.sla} dueAt={r.dueAt} now={ref} tz={timeZone} />
        </span>
      ),
    },
  ];

  const sites = new Set(chosen.map((r) => r.orgId)).size;
  const line =
    newCount > 0 ? `${resultLine} · ${C.newRows(newCount)}` : resultLine;

  const toolbar = (
    <FilterBar
      action="/staff/tickets"
      filters={filters}
      search={{
        name: "q",
        label: C.search,
        value: search,
        helper: C.searchHelper,
      }}
      hidden={{ tab: "inbox" }}
      resultLine={line}
    >
      <QuickFilters label={C.quickLabel} items={quickFilters} />
    </FilterBar>
  );

  let list: ReactNode;
  if (empty === "none") {
    list = (
      <EmptyState
        icon={Inbox}
        heading={P13_COPY.INBOX_EMPTY_H}
        body={P13_COPY.INBOX_EMPTY_B}
      />
    );
  } else if (empty === "filtered") {
    list = (
      <div className="flex flex-wrap items-center gap-2 py-6">
        <p className="font-hub text-base text-hub-ink-muted">{C.filterEmpty}</p>
        <a href={clearHref} className={GHOST}>
          {STAFF_TABLE_COPY.clearFilters}
        </a>
      </div>
    );
  } else {
    list = (
      <div className="flex flex-col">
        {chosen.length > 0 ? (
          <div
            role="group"
            aria-label={C.bulkLabel}
            aria-busy={pending || undefined}
            className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-lg bg-hub-surface-2 p-2 font-hub"
          >
            <span
              className="text-sm font-semibold text-hub-ink"
              aria-live="polite"
            >
              {C.selected(chosen.length)}
            </span>
            <label className="flex items-center gap-1 text-sm">
              {C.bulkAssign}
              <select
                className={SELECT}
                value=""
                disabled={pending}
                onChange={(e) => onAssign(e.currentTarget.value)}
              >
                <option value="">{C.choose}</option>
                <option value="me">{C.me("")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="none">{C.unassigned}</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-sm">
              {C.bulkPriority}
              <select
                className={SELECT}
                value=""
                disabled={pending}
                onChange={(e) => onPriority(e.currentTarget.value)}
              >
                <option value="">{C.choose}</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {STAFF_TABLE_COPY.priority[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-sm">
              {C.bulkStatus}
              <select
                className={SELECT}
                value=""
                disabled={pending}
                onChange={(e) => onStatus(e.currentTarget.value)}
              >
                <option value="">{C.choose}</option>
                {BULK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {staffStatusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={GHOST}
              onClick={() => setSelected([])}
            >
              {C.clearSelection}
            </button>
          </div>
        ) : null}
        <StaffTable
          caption={C.captionBy[sort]}
          columns={split ? compactColumns : fullColumns}
          rows={rows}
          rowKey={(r) => String(r.number)}
          rowLabel={(r) => C.ticketRef(r.number)}
          rowAnnouncement={(r) =>
            `${C.ticketRef(r.number)}, ${r.orgName}, ${staffStatusLabel(r.status)}`
          }
          sort={{ column: sort, direction: "asc" }}
          onSortHref={(id) => sortHrefs[id] ?? inboxHref(listSearch)}
          selectable
          selected={selected}
          onSelectionChange={setSelected}
          primaryHref={(r) => `/staff/tickets/${r.number}`}
          onPrimaryClick={onPrimaryClick}
          currentKey={openNumber !== null ? String(openNumber) : null}
          shortcutsEnabled={shortcutsEnabled}
        />
        {moreHref ? (
          <div className="pt-2">
            <a href={moreHref} className={GHOST}>
              {C.showMore}
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  const dialog = P13_DIALOGS.bulk_status;
  return (
    <div className="flex flex-col gap-4 font-hub" data-inbox="">
      {toolbar}
      {split ? (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]">
          <div className="min-w-0">{list}</div>
          <section
            data-split-detail={openNumber}
            className="min-w-0 max-lg:hidden"
          >
            {detail}
          </section>
        </div>
      ) : (
        list
      )}
      <CaseDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={fillCopy(dialog.title, {
          count: chosen.length,
          status: confirm ? staffStatusLabel(confirm) : "",
        })}
        consequence={fillCopy(dialog.body, { sites })}
        caseRows={chosen
          .slice(0, 10)
          .map((r) => [C.ticketRef(r.number), r.orgName || r.orgId] as const)}
        confirmLabel={dialog.confirm}
        safeLabel={dialog.safe}
        onConfirm={async () => {
          const to = confirm;
          if (!to) return { ok: true, data: null };
          return apply({ numbers: chosen.map((r) => r.number), status: to });
        }}
      />
    </div>
  );
}
