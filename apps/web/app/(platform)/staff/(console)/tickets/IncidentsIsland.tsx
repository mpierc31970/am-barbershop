"use client";
// Incidents island (13-36 choices 3-4; STAFF-12, D103; 13-UI-SPEC "Incidents" lines 540-556).
// The list: SegmentedControl Open · Resolved · All (URL `view=`), secondary Open incident (a
// right Drawer: Title, What owners see with a live P12 IncidentBox "Owners see" preview), and a
// StaffTable (Ref · Title · Status · Linked tickets · Sites · Opened). A row opens the detail
// drawer (`open=I-3`, read on the server): opened / resolved, the public text, Linked tickets
// (# · Site · Status · Age) with per-row ghost Unlink ticket, Link a ticket ("1042") + Link
// ticket, and secondary Resolve incident → CaseDialog "Resolve I-3? 4 linked tickets will move
// to Resolved." with an optional Closing message (Resolve incident · Keep open). Every result
// toast is the CLI line. Row types mirror the @cds/db read model.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { fillCopy, P13_DIALOGS } from "@cds/core/staff";
import type { TicketStatus } from "@cds/core/support";
import {
  Badge,
  Button,
  Drawer,
  InlineAlert,
  SegmentedControl,
  TextArea,
  TextField,
  useToast,
} from "@cds/ui/hub";
import { IncidentBox } from "@cds/ui/hub/support";
import {
  CaseDialog,
  compactAge,
  INCIDENTS_COPY,
  StaffTable,
  staffStatusLabel,
  useStaffAction,
  type StaffColumn,
} from "@cds/ui/staff";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  linkTicketAction,
  openIncidentAction,
  resolveIncidentAction,
  unlinkTicketAction,
} from "../../../../actions/staff/incidents";

const C = INCIDENTS_COPY;
const TZ = BUSINESS_TIME_ZONE;
export type IncidentsView = "open" | "resolved" | "all";

export type IncidentRowView = {
  code: string;
  title: string;
  publicText: string;
  status: "open" | "resolved";
  linked: number;
  sites: number;
  created: string;
  resolvedAt: string | null;
};

export type IncidentTicketView = {
  number: number;
  business: string;
  subject: string;
  status: TicketStatus;
  created: string;
};

function listHref(view: IncidentsView, open?: string): string {
  const q = new URLSearchParams({ tab: "incidents" });
  if (view !== "open") q.set("view", view);
  if (open) q.set("open", open);
  return `/staff/tickets?${q.toString()}`;
}

function ago(iso: string | null, now: string): string {
  if (!iso) return C.none;
  const from = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(from.getTime())) return C.none;
  return compactAge(from, new Date(now), TZ);
}

function StatusBadge({ status }: { status: "open" | "resolved" }) {
  return (
    <Badge tone={status === "open" ? "inc-open" : "inc-resolved"}>
      {C.status[status]}
    </Badge>
  );
}

function OpenIncidentDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const run = useStaffAction(openIncidentAction);
  const [title, setTitle] = useState("");
  const [publicText, setPublicText] = useState("");
  const [errors, setErrors] = useState<{ title?: string; publicText?: string }>(
    {},
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    const e = {
      title: title.trim() ? undefined : C.titleNeeded,
      publicText: publicText.trim() ? undefined : C.publicNeeded,
    };
    setErrors(e);
    setRefusal(null);
    if (e.title || e.publicText) return;
    setPending(true);
    try {
      const res = await run({ title, publicText });
      if (res.ok) {
        toast.show({ message: res.data.message });
        setTitle("");
        setPublicText("");
        onClose();
        router.push(listHref("open", res.data.code));
        router.refresh();
      } else if (res.field === "title" || res.field === "publicText") {
        setErrors({ [res.field]: res.message });
      } else if (res.code !== "session_ended") {
        setRefusal(res.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} label={C.formTitle} side="right">
      <form
        noValidate
        className="flex flex-col gap-6 p-6 font-hub text-hub-ink"
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-xl font-semibold">{C.formTitle}</h2>
        <TextField
          id={`${id}-title`}
          label={C.title}
          helper={C.titleHelp}
          value={title}
          maxLength={80}
          counter={{ value: title.trim().length, max: 80 }}
          onChange={(ev) => setTitle(ev.target.value)}
          error={errors.title}
        />
        <TextArea
          id={`${id}-public`}
          label={C.publicText}
          helper={C.publicHelp}
          rows={4}
          value={publicText}
          counter={{ value: publicText.trim().length, max: 500 }}
          onChange={(ev) => setPublicText(ev.target.value)}
          error={errors.publicText}
        />
        <section className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{C.ownersSee}</p>
          <IncidentBox
            incident={{
              title: title.trim() || C.formTitle,
              public_text: publicText.trim() || C.none,
              status: "open",
            }}
            timeZone={TZ}
            headingLevel="h3"
          />
        </section>
        {refusal ? <InlineAlert tone="error">{refusal}</InlineAlert> : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={pending}>
            {C.openIncident}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export function IncidentsList({
  rows,
  view,
  now,
}: {
  rows: readonly IncidentRowView[];
  view: IncidentsView;
  now: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const columns: StaffColumn<IncidentRowView>[] = [
    {
      id: "ref",
      header: C.cols.ref,
      cell: (r) => r.code,
      priority: 1,
      primary: true,
      nowrap: true,
      width: "72px",
    },
    { id: "title", header: C.cols.title, cell: (r) => r.title, priority: 1 },
    {
      id: "status",
      header: C.cols.status,
      cell: (r) => <StatusBadge status={r.status} />,
      priority: 1,
      stack: true,
    },
    {
      id: "linked",
      header: C.cols.linked,
      cell: (r) => <span className="tabular-nums">{r.linked}</span>,
      priority: 2,
      align: "end",
    },
    {
      id: "sites",
      header: C.cols.sites,
      cell: (r) => <span className="tabular-nums">{r.sites}</span>,
      priority: 3,
      align: "end",
    },
    {
      id: "opened",
      header: C.cols.opened,
      cell: (r) => `${ago(r.created, now)} ago`,
      priority: 3,
      nowrap: true,
    },
  ];
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SegmentedControl
          name="incident-view"
          label={C.viewsLabel}
          options={[
            { value: "open", label: C.views.open },
            { value: "resolved", label: C.views.resolved },
            { value: "all", label: C.views.all },
          ]}
          value={view}
          onChange={(v) => router.push(listHref(v))}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => setCreating(true)}
        >
          {C.openIncident}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">
          {view === "open" ? C.empty : C.emptyAll}
        </p>
      ) : (
        <StaffTable
          caption={C.caption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.code}
          rowLabel={(r) => `${r.code} ${r.title}`}
          primaryHref={(r) => listHref(view, r.code)}
          shortcutsEnabled={false}
        />
      )}
      <OpenIncidentDrawer open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

export function IncidentDrawer({
  incident,
  tickets,
  view,
  now,
}: {
  incident: IncidentRowView;
  tickets: readonly IncidentTicketView[];
  view: IncidentsView;
  now: string;
}) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const link = useStaffAction(linkTicketAction);
  const unlink = useStaffAction(unlinkTicketAction);
  const resolve = useStaffAction(resolveIncidentAction);
  const [ticket, setTicket] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const close = () => router.push(listHref(view));
  const open = incident.status === "open";
  const pendingCount = tickets.filter(
    (t) => t.status !== "resolved" && t.status !== "closed",
  ).length;
  const dialog = P13_DIALOGS.incident_resolve;

  async function doLink() {
    setLinkError(null);
    if (!/^#?\s*[1-9]\d{0,9}$/.test(ticket.trim())) {
      setLinkError(C.linkBad);
      return;
    }
    setLinking(true);
    try {
      const res = await link(incident.code, ticket.trim().replace(/^#\s*/, ""));
      if (res.ok) {
        toast.show({ message: res.data.message });
        setTicket("");
        router.refresh();
      } else if (res.code !== "session_ended") {
        setLinkError(res.message);
      }
    } finally {
      setLinking(false);
    }
  }

  const columns: StaffColumn<IncidentTicketView>[] = [
    {
      id: "number",
      header: C.linkCols.number,
      cell: (t) => `#${t.number}`,
      priority: 1,
      primary: true,
      nowrap: true,
    },
    {
      id: "site",
      header: C.linkCols.site,
      cell: (t) => t.business,
      priority: 1,
    },
    {
      id: "status",
      header: C.linkCols.status,
      cell: (t) => staffStatusLabel(t.status),
      priority: 2,
    },
    {
      id: "age",
      header: C.linkCols.age,
      cell: (t) => ago(t.created, now),
      priority: 3,
      nowrap: true,
    },
    {
      id: "unlink",
      header: C.unlink,
      cell: (t) =>
        open ? (
          <button
            type="button"
            aria-label={C.unlinkLabel(t.number)}
            onClick={async () => {
              setRefusal(null);
              const res = await unlink(incident.code, t.number);
              if (res.ok) {
                toast.show({ message: res.data.message });
                router.refresh();
              } else if (res.code !== "session_ended") {
                setRefusal(res.message);
              }
            }}
            className="rounded px-2 py-1 font-semibold text-hub-accent hover:bg-hub-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
          >
            {C.unlink}
          </button>
        ) : (
          C.none
        ),
      priority: 1,
      align: "end",
    },
  ];

  return (
    <Drawer open onClose={close} label={C.detail(incident.code)} side="right">
      <div className="flex flex-col gap-6 p-6 font-hub text-hub-ink">
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">
            {incident.code} · {incident.title}
          </h2>
          <StatusBadge status={incident.status} />
        </header>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-semibold">{C.openedOn}</dt>
          <dd>{ago(incident.created, now)} ago</dd>
          {incident.resolvedAt ? (
            <>
              <dt className="font-semibold">{C.resolvedOn}</dt>
              <dd>{ago(incident.resolvedAt, now)} ago</dd>
            </>
          ) : null}
          <dt className="font-semibold">{C.linkedTickets}</dt>
          <dd className="tabular-nums">{tickets.length}</dd>
        </dl>
        <section className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{C.ownersSee}</p>
          <IncidentBox
            incident={{
              title: incident.title,
              public_text: incident.publicText,
              status: incident.status,
            }}
            at={incident.resolvedAt}
            timeZone={TZ}
            headingLevel="h3"
          />
        </section>
        <section className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">{C.linkedTickets}</h3>
          {tickets.length === 0 ? (
            <p className="text-sm text-hub-ink-muted">{C.noLinked}</p>
          ) : (
            <StaffTable
              caption={C.linkedCaption(incident.code)}
              columns={columns}
              rows={tickets}
              rowKey={(t) => String(t.number)}
              rowLabel={(t) => `#${t.number}`}
              primaryHref={(t) => `/staff/tickets/${t.number}`}
              shortcutsEnabled={false}
            />
          )}
          {open ? (
            <form
              noValidate
              className="flex flex-wrap items-end gap-2"
              onSubmit={(ev) => {
                ev.preventDefault();
                void doLink();
              }}
            >
              <div className="min-w-40 flex-1">
                <TextField
                  id={`${id}-link`}
                  label={C.linkField}
                  inputMode="numeric"
                  placeholder={C.linkPlaceholder}
                  value={ticket}
                  onChange={(ev) => setTicket(ev.target.value)}
                  error={linkError ?? undefined}
                />
              </div>
              <Button type="submit" variant="secondary" loading={linking}>
                {C.linkButton}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-hub-ink-muted">{C.resolvedNote}</p>
          )}
        </section>
        {refusal ? <InlineAlert tone="error">{refusal}</InlineAlert> : null}
        <div className="flex flex-wrap gap-2 border-t border-hub-border pt-4">
          {open ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setResolving(true)}
            >
              {C.resolve}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={close}>
            {C.close}
          </Button>
        </div>
      </div>
      {resolving ? (
        <CaseDialog
          open
          onClose={() => setResolving(false)}
          title={fillCopy(dialog.title, { code: incident.code })}
          consequence={`${fillCopy(dialog.body, { count: pendingCount })} Their owners get an alert.`}
          caseRows={[
            [C.cols.title, incident.title],
            [C.cols.linked, String(tickets.length)],
          ]}
          reasonField={{
            label: C.closingMessage,
            min: 0,
            max: 5000,
            helper: C.closingHelp,
          }}
          confirmLabel={dialog.confirm}
          safeLabel={dialog.safe}
          onConfirm={async (v) => {
            const res = await resolve(incident.code, v.reason ?? "");
            if (res.ok) {
              toast.show({ message: res.data.message });
              router.refresh();
            }
            return res;
          }}
        />
      ) : null}
    </Drawer>
  );
}
