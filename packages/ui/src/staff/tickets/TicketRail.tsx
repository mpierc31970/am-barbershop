"use client";
// TicketRail (13-35 choice 3; STAFF-05, STAFF-08, STAFF-12, STAFF-19; D92, D96, D297;
// 13-UI-SPEC "TicketRail" lines 458-474, "States" rail selects). Every control saves on change
// (no Save button) through the injected 13-28 action, wrapped in useStaffAction (an ended
// session goes to sign-in): "Saved" shows for 2 s beside it; a failure shows ERR-SAVE (or the
// server's refusal, e.g. "This is a paid service…") inline and the value reverts.
//   1. Status: only legal staff moves enabled (P12 transitions: never back to Open, nothing
//      from Closed). Waiting on owner and Resolved alert the owner, so a CaseDialog asks first.
//   2. Assignee: staff first names + Unassigned, and ghost "Assign to me".
//   3. Priority: Low · Normal · High · Urgent.
//   4. Paid service: Change requests only; P12 categories. Marking moves the ticket to Waiting
//      on owner (server); once marked it shows the category (no unmark action exists).
//   5. Incident: Link to an open incident (shown when the staff role can link), plus "Open a
//      new incident" (Incidents tab, ticket prefilled).
//   6. DescribeList: Site · Opened · First CDS reply · SLA due · Context · Ticket id (copy).
//   7. Ghost "Open as admin" (site Actions tab, reason prefilled).
// The UI is not the gate: each action re-checks the role and the transition on the server.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  PAID_CATEGORIES,
  type PaidCategory,
  type Priority,
  type TicketStatus,
  type TicketType,
} from "@cds/core/support";
import { UserRoundCheck } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { SUPPORT_UI_COPY } from "../../hub/support/copy";
import { CaseDialog, useStaffAction, type StaffActionResult } from "../dialogs";
import { CopyIdButton } from "../sites";
import { STAFF_TABLE_COPY } from "../table";
import {
  STAFF_TICKETS_COPY as C,
  STAFF_TICKET_STATUS_LABELS,
  staffStatusLabel,
} from "./copy";
import { openAsAdminHref } from "./TicketHeaderStrip";

const R = C.rail;
const PRIORITIES: readonly Priority[] = ["low", "normal", "high", "urgent"];
const STATUSES: readonly TicketStatus[] = [
  "open",
  "in_progress",
  "waiting_on_you",
  "resolved",
  "closed",
];
/** Moves that alert the owner: a CaseDialog asks first. */
const ALERTING: readonly TicketStatus[] = ["waiting_on_you", "resolved"];
const SAVED_MS = 2000;

export interface TicketRailView {
  id: string;
  number: number;
  status: TicketStatus;
  type: TicketType;
  priority: Priority;
  assigneeId: string | null;
  /** First name of the assignee (kept as an option even when not in `staff`). */
  assignee: string | null;
  paidCategory: PaidCategory | null;
  incidentCode: string | null;
  orgId: string;
  orgName: string;
  created: string;
  firstRepliedAt: string | null;
  dueAt: string | null;
  context: {
    url: string | null;
    browser: string | null;
    captured_at: string;
  } | null;
}

export interface StaffOption {
  id: string;
  name: string;
}

export interface IncidentOption {
  code: string;
  title: string;
}

type Act<A extends unknown[]> = (
  ...args: A
) => Promise<StaffActionResult<unknown>>;

export interface TicketRailProps {
  ticket: TicketRailView;
  /** Staff who can be assigned (first names). */
  staff: readonly StaffOption[];
  meId: string;
  /** Open incidents; null when the role can't link (the control is left out). */
  incidents: readonly IncidentOption[] | null;
  onStatus: Act<[number, TicketStatus]>;
  /** "me" | "none" | staff id. */
  onAssign: Act<[number, string]>;
  onPriority: Act<[number, Priority]>;
  onPaid: Act<[number, PaidCategory]>;
  onIncident: Act<[number, string]>;
  timeZone?: string;
}

const SELECT =
  "h-8 w-full rounded border border-hub-border-strong bg-hub-surface px-2 font-hub text-sm " +
  "text-hub-ink pointer-coarse:h-11 disabled:opacity-60 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";
const GHOST =
  "inline-flex h-8 items-center gap-1 self-start rounded px-3 font-hub text-sm font-semibold " +
  "text-hub-ink hover:bg-hub-surface-2 pointer-coarse:min-h-11 disabled:opacity-60 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";
const LINK =
  "rounded text-hub-accent underline-offset-2 hover:underline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function errorMessage(r: StaffActionResult<unknown>): string {
  if (r.ok) return "";
  return r.code === "invalid_input" && r.message
    ? r.message
    : SUPPORT_UI_COPY.ERR_SAVE;
}

/** One field's save cycle: optimistic value, "Saved" 2 s, or the error and a revert. */
function useFieldSave<V>(serverValue: V) {
  const [value, setValue] = useState<V>(serverValue);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  useEffect(() => {
    setValue(serverValue);
  }, [serverValue]);
  useEffect(() => {
    if (state.kind !== "saved") return;
    const t = setTimeout(() => setState({ kind: "idle" }), SAVED_MS);
    return () => clearTimeout(t);
  }, [state]);
  async function save(next: V, run: () => Promise<StaffActionResult<unknown>>) {
    const before = value;
    setValue(next);
    setState({ kind: "saving" });
    let r: StaffActionResult<unknown>;
    try {
      r = await run();
    } catch {
      r = { ok: false, code: "unavailable", message: SUPPORT_UI_COPY.ERR_SAVE };
    }
    if (r.ok) {
      setState({ kind: "saved" });
      return true;
    }
    setValue(before);
    setState(
      r.code === "session_ended"
        ? { kind: "idle" }
        : { kind: "error", message: errorMessage(r) },
    );
    return false;
  }
  return { value, state, save };
}

function Field({
  id,
  label,
  state,
  children,
  hint,
}: {
  id: string;
  label: string;
  state: SaveState;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-hub-ink">
          {label}
        </label>
        <span aria-live="polite" className="text-sm text-hub-ink-muted">
          {state.kind === "saved"
            ? R.saved
            : state.kind === "saving"
              ? R.saving
              : ""}
        </span>
      </div>
      {children}
      {hint ? <p className="text-sm text-hub-ink-muted">{hint}</p> : null}
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-hub-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function when(raw: string | null, tz: string): string {
  if (!raw) return C.none;
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return C.none;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Legal staff targets from `from` (P12 nextStatus "staff_set": never Open, never from Closed). */
export function staffStatusEnabled(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  if (from === "closed") return false;
  return to !== "open" && to !== from;
}

export function TicketRail({
  ticket: t,
  staff,
  meId,
  incidents,
  onStatus,
  onAssign,
  onPriority,
  onPaid,
  onIncident,
  timeZone = BUSINESS_TIME_ZONE,
}: TicketRailProps) {
  const base = useId();
  const runStatus = useStaffAction(onStatus);
  const runAssign = useStaffAction(onAssign);
  const runPriority = useStaffAction(onPriority);
  const runPaid = useStaffAction(onPaid);
  const runIncident = useStaffAction(onIncident);

  const status = useFieldSave<TicketStatus>(t.status);
  const assignee = useFieldSave<string>(t.assigneeId ?? "none");
  const priority = useFieldSave<Priority>(t.priority);
  const paid = useFieldSave<string>(t.paidCategory ?? "");
  const incident = useFieldSave<string>(t.incidentCode ?? "");
  const [confirm, setConfirm] = useState<TicketStatus | null>(null);

  const assigneeOptions: StaffOption[] = [...staff];
  if (t.assigneeId && !staff.some((s) => s.id === t.assigneeId)) {
    assigneeOptions.push({
      id: t.assigneeId,
      name: t.assignee ?? STAFF_TABLE_COPY.slaNone,
    });
  }

  function chooseStatus(next: TicketStatus) {
    if (ALERTING.includes(next)) {
      setConfirm(next);
      return;
    }
    void status.save(next, () => runStatus(t.number, next));
  }

  const ctxLine = t.context
    ? [t.context.url, t.context.browser, when(t.context.captured_at, timeZone)]
        .filter((v): v is string => Boolean(v && v !== C.none))
        .join(" · ")
    : "";

  return (
    <aside
      aria-label={R.heading}
      data-ticket-rail={t.number}
      className="flex flex-col gap-4 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      <h2 className="sr-only">{R.heading}</h2>
      <Field id={`${base}-status`} label={R.status} state={status.state}>
        <select
          id={`${base}-status`}
          value={status.value}
          disabled={t.status === "closed" || status.state.kind === "saving"}
          onChange={(e) => chooseStatus(e.currentTarget.value as TicketStatus)}
          className={SELECT}
        >
          {STATUSES.map((s) => (
            <option
              key={s}
              value={s}
              disabled={
                s !== status.value && !staffStatusEnabled(status.value, s)
              }
            >
              {STAFF_TICKET_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>

      <Field id={`${base}-assignee`} label={R.assignee} state={assignee.state}>
        <select
          id={`${base}-assignee`}
          value={assignee.value}
          disabled={assignee.state.kind === "saving"}
          onChange={(e) => {
            const v = e.currentTarget.value;
            void assignee.save(v, () => runAssign(t.number, v));
          }}
          className={SELECT}
        >
          <option value="none">{C.unassigned}</option>
          {assigneeOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {assignee.value !== meId ? (
          <button
            type="button"
            className={GHOST}
            disabled={assignee.state.kind === "saving"}
            onClick={() =>
              void assignee.save(meId, () => runAssign(t.number, "me"))
            }
          >
            <UserRoundCheck aria-hidden size={16} strokeWidth={2} />
            {R.assignMe}
          </button>
        ) : null}
      </Field>

      <Field id={`${base}-priority`} label={R.priority} state={priority.state}>
        <select
          id={`${base}-priority`}
          value={priority.value}
          disabled={priority.state.kind === "saving"}
          onChange={(e) => {
            const v = e.currentTarget.value as Priority;
            void priority.save(v, () => runPriority(t.number, v));
          }}
          className={SELECT}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {STAFF_TABLE_COPY.priority[p]}
            </option>
          ))}
        </select>
      </Field>

      {t.type === "change" ? (
        <Field id={`${base}-paid`} label={R.paid} state={paid.state}>
          <select
            id={`${base}-paid`}
            value={paid.value}
            disabled={
              t.paidCategory !== null ||
              t.status === "closed" ||
              paid.state.kind === "saving"
            }
            onChange={(e) => {
              const v = e.currentTarget.value as PaidCategory;
              if (!v) return;
              void paid.save(v, () => runPaid(t.number, v));
            }}
            className={SELECT}
          >
            <option value="">{R.notPaid}</option>
            {PAID_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {incidents ? (
        <Field
          id={`${base}-incident`}
          label={R.incident}
          state={incident.state}
        >
          <select
            id={`${base}-incident`}
            value={incident.value}
            disabled={incident.state.kind === "saving"}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (!v) return;
              void incident.save(v, () => runIncident(t.number, v));
            }}
            className={SELECT}
          >
            <option value="" disabled={incident.value !== ""}>
              {R.noIncident}
            </option>
            {t.incidentCode &&
            !incidents.some((i) => i.code === t.incidentCode) ? (
              <option value={t.incidentCode}>{t.incidentCode}</option>
            ) : null}
            {incidents.map((i) => (
              <option key={i.code} value={i.code}>
                {`${i.code} · ${i.title}`}
              </option>
            ))}
          </select>
          <a
            href={`/staff/tickets?tab=incidents&ticket=${t.number}`}
            className={GHOST}
          >
            {R.newIncident}
          </a>
        </Field>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-hub-ink-muted">{R.site}</dt>
        <dd>
          <a
            href={`/staff/sites/${encodeURIComponent(t.orgId)}`}
            className={LINK}
          >
            {t.orgName || t.orgId}
          </a>
        </dd>
        <dt className="text-hub-ink-muted">{R.opened}</dt>
        <dd className="tabular-nums">{when(t.created, timeZone)}</dd>
        <dt className="text-hub-ink-muted">{R.firstReply}</dt>
        <dd className="tabular-nums">{when(t.firstRepliedAt, timeZone)}</dd>
        <dt className="text-hub-ink-muted">{R.slaDue}</dt>
        <dd className="tabular-nums">{when(t.dueAt, timeZone)}</dd>
        <dt className="text-hub-ink-muted">{R.context}</dt>
        <dd className="break-words">{ctxLine || C.none}</dd>
        <dt className="text-hub-ink-muted">{R.ticketId}</dt>
        <dd className="flex items-center gap-2">
          <code className="text-sm">{t.id}</code>
          <CopyIdButton value={t.id} />
        </dd>
      </dl>

      <a href={openAsAdminHref(t.orgId, t.number)} className={GHOST}>
        {C.openAsAdmin}
      </a>

      <CaseDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={C.statusDialog.title(
          t.number,
          confirm ? staffStatusLabel(confirm) : "",
        )}
        consequence={C.statusDialog.body}
        caseRows={[
          [R.site, t.orgName || t.orgId],
          [
            R.status,
            `${staffStatusLabel(t.status)} → ${confirm ? staffStatusLabel(confirm) : ""}`,
          ],
        ]}
        confirmLabel={C.statusDialog.confirm}
        safeLabel={C.statusDialog.safe}
        onConfirm={async () => {
          const next = confirm;
          if (!next) return { ok: true, data: null };
          // A refusal shows inline under the Status select (and the value reverts).
          await status.save(next, () => runStatus(t.number, next));
          return { ok: true, data: null };
        }}
      />
    </aside>
  );
}
