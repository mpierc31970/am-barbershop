"use client";
// DemoPanel (13-46 choice 3; STAFF-18, D293, P13-P13; 13-UI-SPEC "Settings" Demo tenant, line
// 1085). The permanent demo tenant at a glance: Site (link + `demo` badge), Host (preview), Last
// reset, Next reset, last reset counts and What's blocked; then secondary **Reset now** → the
// destructive CaseDialog "Reset Bella's Salon now? · No other site changes." (safe button
// focused) → the action through useStaffAction (step-up when needed) → Toast.
import { fillCopy, P13_DIALOGS } from "@cds/core/staff";
import { useState } from "react";
import { Badge } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { useToast } from "../../hub/Toast";
import { CaseDialog, useStaffAction, type StaffActionResult } from "../dialogs";
import { SETTINGS_COPY } from "./copy";

const C = SETTINGS_COPY.demo;
const D = P13_DIALOGS.demo_reset;

export interface DemoPanelView {
  /** "Bella's Salon". */
  name: string;
  /** Null until the first reset creates the demo org. */
  orgId: string | null;
  /** Preview host ("demo.sites.connectionsdesignstudios.com") or null. */
  host: string | null;
  /** Formatted last reset ("Oct 16, 3:30 am") or null when never reset. */
  lastReset: string | null;
  /** Whether the last job run finished without a failed step (null = unknown). */
  lastResetOk: boolean | null;
  /** Formatted next reset ("Oct 17, 3:30 am"). */
  nextReset: string;
  counts: { rowsDeleted: number; rowsSeeded: number } | null;
}

export type DemoResetRun = () => Promise<
  StaffActionResult<{ message: string }>
>;

export interface DemoPanelProps {
  view: DemoPanelView;
  reset: DemoResetRun;
  /** Staff site page for the demo org (default /staff/sites/<id>). */
  siteHref?: (orgId: string) => string;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function defaultSiteHref(orgId: string): string {
  return `/staff/sites/${encodeURIComponent(orgId)}`;
}

export function DemoPanel({
  view,
  reset,
  siteHref = defaultSiteHref,
}: DemoPanelProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const title = fillCopy(D.title, { business: view.name });
  const run = useStaffAction(reset, { describe: () => title });
  const lastLine = view.lastReset
    ? view.lastResetOk === false
      ? view.lastReset
      : `${view.lastReset} · ${C.ok}`
    : C.never;

  return (
    <section className="flex flex-col gap-6">
      {view.orgId ? null : (
        <p className="text-base text-hub-ink-muted">{C.missing}</p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt className="text-hub-ink-muted">{C.site}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {view.orgId ? (
            <a href={siteHref(view.orgId)} className={LINK}>
              {view.name}
            </a>
          ) : (
            <span>{view.name}</span>
          )}
          <Badge tone="demo">{C.badge}</Badge>
        </dd>
        <dt className="text-hub-ink-muted">{C.host}</dt>
        <dd className="break-all">
          {view.host ? (
            <a
              href={`https://${view.host}/`}
              className={LINK}
              target="_blank"
              rel="noopener noreferrer"
            >
              {view.host}
            </a>
          ) : (
            C.noHost
          )}
        </dd>
        <dt className="text-hub-ink-muted">{C.lastReset}</dt>
        <dd className="tabular-nums">{lastLine}</dd>
        <dt className="text-hub-ink-muted">{C.nextReset}</dt>
        <dd className="tabular-nums">{view.nextReset}</dd>
        <dt className="text-hub-ink-muted">{C.lastCounts}</dt>
        <dd className="tabular-nums">
          {view.counts
            ? C.counts(view.counts.rowsDeleted, view.counts.rowsSeeded)
            : C.noCounts}
        </dd>
        <dt className="text-hub-ink-muted">{C.blocked}</dt>
        <dd>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {C.blockedList.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </dd>
      </dl>
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {C.resetNow}
        </Button>
      </div>
      {open ? (
        <CaseDialog
          open
          onClose={() => setOpen(false)}
          title={title}
          consequence={D.body}
          caseRows={[
            [C.caseSite, view.name],
            [C.caseHost, view.host ?? C.noHost],
          ]}
          confirmLabel={D.confirm}
          safeLabel={D.safe}
          destructive
          onConfirm={async () => {
            const res = await run();
            if (res.ok) toast.show({ message: res.data.message });
            return res;
          }}
        />
      ) : null}
    </section>
  );
}
