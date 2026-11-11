"use client";
// FailsafeInbox (13-45 choice 3; STAFF-14, D155, D269; 13-UI-SPEC "Fail-safe requests" line
// 893, tones line 218; T-13-45-02). Requests captured off the main server during an outage.
// Status filter (URL-driven chips: Pending · Converted · Dismissed · All), the deployment line
// ("Capture service: not deployed (GO-LIVE)"), then the table: Received · Site · Add-on ·
// Request summary ("Sat morning · Ana R.", with the captured details in a disclosure and the
// "intent only" label) · State (`fs-*`) · Action. Pending rows carry one-click **Convert**
// (the add-on's own convert path through the server; a conflict shows the add-on's conflict
// text inline and the row stays Pending) and ghost **Dismiss** (CaseDialog, reason required).
// Buttons are disabled while a request runs (no double convert; the server re-checks too).
// The rows hold visitor contact details: staff-only, never logged.
import { useState } from "react";
import { Badge, type BadgeTone } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { useToast } from "../../hub/Toast";
import { CaseDialog, useStaffAction, type StaffActionResult } from "../dialogs";
import { QuickFilters, StaffTable, type StaffColumn } from "../table";
import { formatHealthTime, HEALTH_COPY } from "./copy";

const C = HEALTH_COPY.failsafe;

export type FailsafeStatusWord = "pending" | "converted" | "dismissed";
export type FailsafeFilter = FailsafeStatusWord | "all";

export interface FailsafeRowView {
  id: string;
  orgId: string;
  business: string;
  /** Add-on display name. */
  addon: string;
  name: string;
  email: string;
  phone: string;
  preferred: string;
  message: string;
  capturedAt: string;
  status: FailsafeStatusWord;
  convertedRef: string;
}

export type FailsafeConvertResult =
  | { converted: true; ref: string; message: string }
  | { converted: false; conflict: string; message: string };

export type FailsafeConvert = (
  id: string,
) => Promise<StaffActionResult<FailsafeConvertResult>>;
export type FailsafeDismiss = (
  id: string,
  reason: string,
) => Promise<StaffActionResult<{ message: string }>>;

export interface FailsafeDeployment {
  deployed: boolean;
  pending: number;
  /** Formatted last pull, or null. */
  lastPull: string | null;
}

export interface FailsafeInboxProps {
  rows: readonly FailsafeRowView[];
  filter: FailsafeFilter;
  /** `?status=` link per filter. */
  filterHref: (f: FailsafeFilter) => string;
  deployment: FailsafeDeployment;
  convert: FailsafeConvert;
  dismiss: FailsafeDismiss;
  siteHref?: (orgId: string) => string;
}

export const FAILSAFE_TONE: Readonly<Record<FailsafeStatusWord, BadgeTone>> = {
  pending: "fs-pending",
  converted: "fs-done",
  dismissed: "fs-dismissed",
};

const FILTERS: readonly FailsafeFilter[] = [
  "pending",
  "converted",
  "dismissed",
  "all",
];

/** "Sat morning · Ana R." from the captured fields. */
export function failsafeSummary(r: FailsafeRowView): string {
  const parts = [r.preferred.trim(), shortName(r.name)].filter((s) => s);
  return parts.join(" · ") || r.message.trim().slice(0, 60) || HEALTH_COPY.none;
}

function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] ?? "";
  return `${words[0]} ${words[words.length - 1]![0]!.toUpperCase()}.`;
}

function who(r: FailsafeRowView): string {
  return shortName(r.name) || r.business || r.id;
}

export function failsafeDeploymentText(d: FailsafeDeployment): string {
  return d.deployed ? C.deployed(d.pending, d.lastPull) : C.notDeployed;
}

function defaultSiteHref(orgId: string): string {
  return `/staff/sites/${orgId}`;
}

export function FailsafeInbox({
  rows,
  filter,
  filterHref,
  deployment,
  convert,
  dismiss,
  siteHref = defaultSiteHref,
}: FailsafeInboxProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [handled, setHandled] = useState<Record<string, FailsafeStatusWord>>(
    {},
  );
  const [dismissing, setDismissing] = useState<FailsafeRowView | null>(null);
  const runConvert = useStaffAction(convert, {
    describe: ([id]) => {
      const r = rows.find((x) => x.id === id);
      return r ? C.convertLabel(who(r)) : C.convert;
    },
  });
  const runDismiss = useStaffAction(dismiss, {
    describe: ([id]) => {
      const r = rows.find((x) => x.id === id);
      return r ? C.dismissLabel(who(r)) : C.dismiss;
    },
  });

  const statusOf = (r: FailsafeRowView): FailsafeStatusWord =>
    handled[r.id] ?? r.status;

  async function onConvert(r: FailsafeRowView) {
    setBusy(r.id);
    try {
      const res = await runConvert(r.id);
      if (!res.ok) {
        // WR-E11: a stopped step-up or an ended session says nothing.
        if (
          res.message &&
          res.code !== "step_up_needed" &&
          res.code !== "session_ended"
        ) {
          toast.show({ message: res.message });
        }
        return;
      }
      if (res.data.converted) {
        setConflicts((c) => {
          const next = { ...c };
          delete next[r.id];
          return next;
        });
        setHandled((h) => ({ ...h, [r.id]: "converted" }));
        toast.show({ message: res.data.message });
      } else {
        const conflict = res.data.conflict;
        setConflicts((c) => ({ ...c, [r.id]: conflict }));
      }
    } finally {
      setBusy(null);
    }
  }

  const columns: StaffColumn<FailsafeRowView>[] = [
    {
      id: "received",
      header: HEALTH_COPY.cols.received,
      priority: 1,
      stack: true,
      nowrap: true,
      cell: (r) => (
        <span className="tabular-nums">
          {formatHealthTime(r.capturedAt) ?? HEALTH_COPY.none}
        </span>
      ),
    },
    {
      id: "site",
      header: HEALTH_COPY.cols.site,
      priority: 1,
      stack: true,
      primary: true,
      cell: (r) => (
        <span className="font-semibold">{r.business || r.orgId}</span>
      ),
    },
    {
      id: "addon",
      header: HEALTH_COPY.cols.addon,
      priority: 2,
      cell: (r) => r.addon,
    },
    {
      id: "request",
      header: HEALTH_COPY.cols.request,
      priority: 1,
      stack: true,
      cell: (r) => (
        <details className="text-sm">
          <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent">
            {failsafeSummary(r)}
          </summary>
          <p className="mt-2 text-hub-ink-muted">{C.intent}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {(
              [
                [C.name, r.name],
                [C.email, r.email],
                [C.phone, r.phone],
                [C.preferred, r.preferred],
                [C.message, r.message],
              ] as const
            )
              .filter(([, v]) => v.trim() !== "")
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-semibold">{k}</dt>
                  <dd className="break-words whitespace-pre-line">{v}</dd>
                </div>
              ))}
          </dl>
        </details>
      ),
    },
    {
      id: "state",
      header: HEALTH_COPY.cols.state,
      priority: 1,
      stack: true,
      cell: (r) => {
        const s = statusOf(r);
        return <Badge tone={FAILSAFE_TONE[s]}>{C.status[s]}</Badge>;
      },
    },
    {
      id: "action",
      header: HEALTH_COPY.cols.action,
      priority: 1,
      stack: true,
      cell: (r) => {
        if (statusOf(r) !== "pending") {
          return r.convertedRef ? (
            <span className="text-sm text-hub-ink-muted">{r.convertedRef}</span>
          ) : null;
        }
        const conflict = conflicts[r.id];
        return (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                aria-label={C.convertLabel(who(r))}
                loading={busy === r.id}
                disabled={busy !== null && busy !== r.id}
                onClick={() => void onConvert(r)}
              >
                {C.convert}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={C.dismissLabel(who(r))}
                disabled={busy !== null}
                onClick={() => setDismissing(r)}
              >
                {C.dismiss}
              </Button>
            </div>
            {conflict ? (
              <p role="alert" className="text-sm text-hub-danger">
                {C.conflictPrefix}
                {conflict}
              </p>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <section className="flex flex-col gap-4 font-hub text-hub-ink">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{C.heading}</h2>
        <p className="text-sm text-hub-ink-muted">
          {failsafeDeploymentText(deployment)}
        </p>
      </div>
      <QuickFilters
        label={C.filters}
        items={FILTERS.map((f) => ({
          id: f,
          label: C.filter[f],
          href: filterHref(f),
          pressed: f === filter,
        }))}
      />
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">{C.empty}</p>
      ) : (
        <StaffTable
          caption={C.caption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowLabel={(r) => `${r.business || r.orgId} · ${failsafeSummary(r)}`}
          primaryHref={(r) => siteHref(r.orgId)}
          shortcutsEnabled={false}
        />
      )}
      {dismissing ? (
        <CaseDialog
          open
          onClose={() => setDismissing(null)}
          title={C.dismissTitle}
          consequence={C.dismissBody}
          caseRows={[
            [HEALTH_COPY.cols.site, dismissing.business || dismissing.orgId],
            [HEALTH_COPY.cols.addon, dismissing.addon],
            [HEALTH_COPY.cols.request, failsafeSummary(dismissing)],
          ]}
          confirmLabel={C.dismissConfirm}
          safeLabel={C.dismissSafe}
          destructive
          reasonField={{ label: C.reasonLabel, min: 3, max: 200 }}
          onConfirm={async (v) => {
            const target = dismissing;
            const res = await runDismiss(target.id, v.reason ?? "");
            if (res.ok) {
              setHandled((h) => ({ ...h, [target.id]: "dismissed" }));
              toast.show({ message: res.data.message });
            }
            return res;
          }}
        />
      ) : null}
    </section>
  );
}
