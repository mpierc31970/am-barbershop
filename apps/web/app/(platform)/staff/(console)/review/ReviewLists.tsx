"use client";
// Review queue lists (13-38 choice 2; STAFF-23, STAFF-24, STAFF-26; D248, D292, P13-P10;
// 13-UI-SPEC "Review queue" lines 678-730, tones 211-212). Client islands for the three tabs:
// - FlagsList: Kind (r-held / r-held-late with Hourglass "Held 3 days" / r-flag / r-queued) ·
//   Site · What · Why · Age · Assignee, in the read model's order (held past promise first), plus
//   the read-only fit-hold link row "1 fit hold · in Pipeline";
// - SpotList: Case · Site · Why picked · Pages (marked/total) · Opened;
// - ReportsList: Case · Kind (r-report / r-dmca) · Site (+ repeat) · Category · Current step ·
//   Due · Received · Assignee, with Log a report (a right Drawer with the /report fields plus
//   Received by / Received at; primary Log report; toast "Case R-32 logged. The owner was not
//   contacted."). A logged report is a case, never a ticket (D292).
// Every row opens the case page. Rows are plain text (T-13-38-03: no HTML from reports).
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  Badge,
  Button,
  Drawer,
  InlineAlert,
  RadioCardGroup,
  SegmentedControl,
  Select,
  TextArea,
  TextField,
  useToast,
  type BadgeTone,
} from "@cds/ui/hub";
import {
  compactAge,
  formatCaseDay,
  REVIEW_COPY,
  StaffTable,
  useStaffAction,
  type StaffColumn,
} from "@cds/ui/staff";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { logReportAction } from "../../../../actions/staff/review";
import {
  REPORT_CATEGORIES,
  REPORT_COPY,
  REPORT_DESCRIPTION_MAX,
} from "../../../../../lib/report-form";

const C = REVIEW_COPY;
const TZ = BUSINESS_TIME_ZONE;

export type ReviewListView = "open" | "done";

export type FlagRowView = {
  ref: string;
  held: boolean;
  queued: boolean;
  heldDays: number | null;
  late: boolean;
  business: string;
  what: string;
  why: string;
  createdAt: string;
  assignee: string;
  href: string;
};

export type SpotRowView = {
  ref: string;
  business: string;
  whyPicked: string;
  marked: number;
  total: number;
  opened: string;
  late: boolean;
  href: string;
};

export type ReportRowView = {
  ref: string;
  kind: "report" | "dmca";
  business: string;
  repeat: boolean;
  category: string;
  step: string;
  due: string | null;
  late: boolean;
  received: string;
  assignee: string;
  href: string;
};

function listHref(tab: string, view: ReviewListView): string {
  return view === "open"
    ? `/staff/review?tab=${tab}`
    : `/staff/review?tab=${tab}&view=done`;
}

function ago(iso: string, now: string): string {
  const from = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(from.getTime())) return C.none;
  return `${compactAge(from, new Date(now), TZ)} ago`;
}

function ViewToggle({
  tab,
  view,
  closedWord = false,
}: {
  tab: string;
  view: ReviewListView;
  closedWord?: boolean;
}) {
  const router = useRouter();
  return (
    <SegmentedControl
      name={`review-${tab}-view`}
      label={C.viewsLabel}
      options={[
        { value: "open", label: C.views.open },
        { value: "done", label: closedWord ? C.views.closed : C.views.done },
      ]}
      value={view}
      onChange={(v) => router.push(listHref(tab, v))}
    />
  );
}

function flagTone(r: FlagRowView): BadgeTone {
  if (r.held) return r.late ? "r-held-late" : "r-held";
  return r.queued ? "r-queued" : "r-flag";
}

function flagKindText(r: FlagRowView): string {
  if (r.held && r.heldDays !== null) return C.held(r.heldDays);
  if (r.held) return C.status.held;
  return r.queued ? C.kind.queued : C.kind.scan_flag;
}

export function FlagsList({
  rows,
  fitHolds,
  view,
  now,
}: {
  rows: readonly FlagRowView[];
  fitHolds: number;
  view: ReviewListView;
  now: string;
}) {
  const columns: StaffColumn<FlagRowView>[] = [
    {
      id: "kind",
      header: C.cols.kind,
      cell: (r) => <Badge tone={flagTone(r)}>{flagKindText(r)}</Badge>,
      priority: 1,
      stack: true,
      nowrap: true,
    },
    { id: "site", header: C.cols.site, cell: (r) => r.business, priority: 1 },
    {
      id: "what",
      header: C.cols.what,
      cell: (r) => r.what,
      priority: 1,
      primary: true,
    },
    { id: "why", header: C.cols.why, cell: (r) => r.why, priority: 3 },
    {
      id: "age",
      header: C.cols.age,
      cell: (r) =>
        r.held && r.heldDays !== null ? (
          <span className={r.late ? "text-hub-danger" : undefined}>
            {C.heldAge(r.heldDays)}
          </span>
        ) : (
          ago(r.createdAt, now)
        ),
      priority: 2,
      nowrap: true,
    },
    {
      id: "assignee",
      header: C.cols.assignee,
      cell: (r) => r.assignee,
      priority: 4,
    },
  ];
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ViewToggle tab="flags" view={view} />
      </div>
      {view === "open" && fitHolds > 0 ? (
        <p className="text-sm">
          <Link
            href="/staff/pipeline?tab=fit"
            className="font-semibold text-hub-accent underline underline-offset-2"
          >
            {C.fitHolds(fitHolds)}
          </Link>
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">
          {view === "open" ? C.flagsEmpty : C.flagsEmptyDone}
        </p>
      ) : (
        <StaffTable
          caption={C.flagsCaption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.ref}
          rowLabel={(r) => `${r.what}, ${r.business}`}
          primaryHref={(r) => r.href}
          shortcutsEnabled={false}
        />
      )}
    </div>
  );
}

export function SpotList({
  rows,
  view,
  now,
}: {
  rows: readonly SpotRowView[];
  view: ReviewListView;
  now: string;
}) {
  void now;
  const columns: StaffColumn<SpotRowView>[] = [
    {
      id: "case",
      header: C.cols.case,
      cell: (r) => r.ref,
      priority: 1,
      primary: true,
      nowrap: true,
      width: "88px",
    },
    { id: "site", header: C.cols.site, cell: (r) => r.business, priority: 1 },
    {
      id: "why",
      header: C.cols.whyPicked,
      cell: (r) => r.whyPicked,
      priority: 3,
    },
    {
      id: "pages",
      header: C.cols.pages,
      cell: (r) => (
        <span className="tabular-nums">{C.pagesMarked(r.marked, r.total)}</span>
      ),
      priority: 1,
      align: "end",
      stack: true,
    },
    {
      id: "opened",
      header: C.cols.opened,
      cell: (r) => formatCaseDay(r.opened, TZ),
      priority: 2,
      nowrap: true,
    },
  ];
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ViewToggle tab="spot" view={view} closedWord />
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">
          {view === "open" ? C.spotEmpty : C.spotEmptyDone}
        </p>
      ) : (
        <StaffTable
          caption={C.spotCaption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.ref}
          rowLabel={(r) => `${r.ref} ${r.business}`}
          primaryHref={(r) => r.href}
          shortcutsEnabled={false}
        />
      )}
    </div>
  );
}

export function ReportsList({
  rows,
  view,
}: {
  rows: readonly ReportRowView[];
  view: ReviewListView;
}) {
  const [logging, setLogging] = useState(false);
  const columns: StaffColumn<ReportRowView>[] = [
    {
      id: "case",
      header: C.cols.case,
      cell: (r) => r.ref,
      priority: 1,
      primary: true,
      nowrap: true,
      width: "88px",
    },
    {
      id: "kind",
      header: C.cols.kind,
      cell: (r) => (
        <Badge tone={r.kind === "dmca" ? "r-dmca" : "r-report"}>
          {C.kind[r.kind]}
        </Badge>
      ),
      priority: 1,
      stack: true,
    },
    {
      id: "site",
      header: C.cols.site,
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {r.business}
          {r.repeat ? <Badge tone="repeat">{C.repeat}</Badge> : null}
        </span>
      ),
      priority: 1,
    },
    {
      id: "category",
      header: C.cols.category,
      cell: (r) => r.category,
      priority: 3,
    },
    { id: "step", header: C.cols.step, cell: (r) => r.step, priority: 2 },
    {
      id: "due",
      header: C.cols.due,
      cell: (r) =>
        r.due ? (
          <span className={r.late ? "text-hub-danger" : undefined}>
            {formatCaseDay(r.due, TZ)}
          </span>
        ) : (
          C.none
        ),
      priority: 2,
      nowrap: true,
    },
    {
      id: "received",
      header: C.cols.received,
      cell: (r) => formatCaseDay(r.received, TZ),
      priority: 3,
      nowrap: true,
    },
    {
      id: "assignee",
      header: C.cols.assignee,
      cell: (r) => r.assignee,
      priority: 4,
    },
  ];
  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ViewToggle tab="reports" view={view} closedWord />
        <Button
          type="button"
          variant="secondary"
          onClick={() => setLogging(true)}
        >
          {C.logReport}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">
          {view === "open" ? C.reportsEmpty : C.reportsEmptyClosed}
        </p>
      ) : (
        <StaffTable
          caption={C.reportsCaption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.ref}
          rowLabel={(r) => `${r.ref} ${r.business}`}
          primaryHref={(r) => r.href}
          shortcutsEnabled={false}
        />
      )}
      <LogReportDrawer open={logging} onClose={() => setLogging(false)} />
    </div>
  );
}

type LogFields = {
  category: string;
  url: string;
  description: string;
  name: string;
  email: string;
  goodFaith: boolean;
  accuracy: boolean;
  signature: string;
  receivedVia: "email" | "phone" | "other";
  receivedAt: string;
};

const EMPTY_LOG: LogFields = {
  category: "",
  url: "",
  description: "",
  name: "",
  email: "",
  goodFaith: false,
  accuracy: false,
  signature: "",
  receivedVia: "email",
  receivedAt: "",
};

export function LogReportDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const run = useStaffAction(logReportAction);
  const [v, setV] = useState<LogFields>(EMPTY_LOG);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copyright = v.category === "copyright";
  const set = <K extends keyof LogFields>(k: K, value: LogFields[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));

  async function submit() {
    setErrors({});
    setRefusal(null);
    setPending(true);
    try {
      const res = await run(v);
      if (res.ok) {
        toast.show({ message: res.data.message });
        setV(EMPTY_LOG);
        onClose();
        router.push(`/staff/review/${res.data.ref}`);
        router.refresh();
      } else if (res.field) {
        setErrors({ [res.field]: res.message });
      } else if (res.code !== "session_ended") {
        setRefusal(res.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} label={C.logReport} side="right">
      <form
        noValidate
        className="flex flex-col gap-6 p-6 font-hub text-hub-ink"
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-xl font-semibold">{C.logReport}</h2>
        <RadioCardGroup
          name={`${id}-category`}
          legend={REPORT_COPY.CATEGORY_LEGEND}
          options={REPORT_CATEGORIES.map((c) => ({
            value: c,
            title: REPORT_COPY.CATEGORY[c].title,
          }))}
          value={v.category || null}
          onChange={(c) => set("category", c)}
          invalid={Boolean(errors.category)}
          {...(errors.category ? { describedBy: `${id}-category-error` } : {})}
        />
        {errors.category ? (
          <p id={`${id}-category-error`} className="text-sm text-hub-danger">
            {errors.category}
          </p>
        ) : null}
        <TextField
          id={`${id}-url`}
          label={REPORT_COPY.URL}
          type="url"
          value={v.url}
          onChange={(ev) => set("url", ev.target.value)}
          error={errors.url}
        />
        <TextArea
          id={`${id}-description`}
          label={REPORT_COPY.DESCRIPTION}
          rows={5}
          value={v.description}
          counter={{
            value: v.description.trim().length,
            max: REPORT_DESCRIPTION_MAX,
          }}
          onChange={(ev) => set("description", ev.target.value)}
          error={errors.description}
        />
        <TextField
          id={`${id}-name`}
          label={REPORT_COPY.NAME}
          value={v.name}
          onChange={(ev) => set("name", ev.target.value)}
          error={errors.name}
        />
        <TextField
          id={`${id}-email`}
          label={REPORT_COPY.EMAIL}
          type="email"
          helper={C.emailOptional}
          value={v.email}
          onChange={(ev) => set("email", ev.target.value)}
          error={errors.email}
        />
        {copyright ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-semibold">
              {REPORT_COPY.DMCA_LEGEND}
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={v.goodFaith}
                onChange={(ev) => set("goodFaith", ev.target.checked)}
              />
              {REPORT_COPY.DMCA_GOODFAITH}
            </label>
            {errors.goodFaith ? (
              <p className="text-sm text-hub-danger">{errors.goodFaith}</p>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={v.accuracy}
                onChange={(ev) => set("accuracy", ev.target.checked)}
              />
              {REPORT_COPY.DMCA_ACCURATE}
            </label>
            {errors.accuracy ? (
              <p className="text-sm text-hub-danger">{errors.accuracy}</p>
            ) : null}
            <TextField
              id={`${id}-signature`}
              label={REPORT_COPY.SIGNATURE}
              helper={REPORT_COPY.SIGNATURE_HELPER}
              value={v.signature}
              onChange={(ev) => set("signature", ev.target.value)}
              error={errors.signature}
            />
          </fieldset>
        ) : null}
        <Select
          id={`${id}-via`}
          label={C.receivedBy}
          value={v.receivedVia}
          options={[
            { value: "email", label: C.receivedVia.email },
            { value: "phone", label: C.receivedVia.phone },
            { value: "other", label: C.receivedVia.other },
          ]}
          onChange={(ev) =>
            set("receivedVia", ev.target.value as LogFields["receivedVia"])
          }
        />
        <TextField
          id={`${id}-at`}
          label={C.receivedAt}
          helper={C.receivedAtHelper}
          type="datetime-local"
          value={v.receivedAt}
          onChange={(ev) => set("receivedAt", ev.target.value)}
          error={errors.receivedAt}
        />
        {refusal ? <InlineAlert tone="error">{refusal}</InlineAlert> : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={pending}>
            {C.logReportSubmit}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
