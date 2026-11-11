"use client";
// IndexingTable (13-39 choices 1 and 3; STAFF-17, D190; 13-UI-SPEC "Indexing" lines 911-915,
// tones line 217, dialog line 1086; T-13-39-01). Site · Last ping ("2 Oct · logged
// (stand-in)") · Sitemap (h-ok "OK" / h-critical "Error" / h-none "Not checked") · Pages
// indexed ("—" until Search Console) · Last resubmit · ghost sm **Resubmit now** (RotateCw).
// With `resubmitAll`, the header carries secondary **Resubmit all live sites** → CaseDialog
// "Resubmit {n} live sites?" (demo skipped) → **Resubmit all** / **Not now**. Every resubmit is
// a Server Action POST through useStaffAction (never a GET); the result line is the toast.
import { fillCopy, P13_DIALOGS } from "@cds/core/staff";
import { RotateCw } from "lucide-react";
import { useState } from "react";
import { Badge, type BadgeTone } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { useToast } from "../../hub/Toast";
import { CaseDialog, useStaffAction, type StaffActionResult } from "../dialogs";
import { StaffTable, type StaffColumn } from "../table";
import {
  formatIndexingDay,
  formatIndexingTime,
  INDEXING_COPY as C,
} from "./copy";

export type IndexingPingWord = "logged" | "ok" | "error" | "skipped";
export type IndexingSitemapWord = "ok" | "error" | "unchecked";

export interface IndexingRowView {
  orgId: string;
  business: string;
  host: string | null;
  live: boolean;
  demo: boolean;
  lastPingAt: string | null;
  lastPingResult: IndexingPingWord | null;
  sitemapStatus: IndexingSitemapWord;
  /** Null until Search Console is connected (GO-LIVE). */
  pagesIndexed: number | null;
  lastResubmitAt: string | null;
}

export type IndexingResubmit = (
  orgId: string,
) => Promise<StaffActionResult<{ message: string }>>;
export type IndexingResubmitAll = () => Promise<
  StaffActionResult<{ message: string }>
>;

export interface IndexingTableProps {
  rows: readonly IndexingRowView[];
  /** The weekly job's last successful run (ISO), for the schedule line. */
  lastRunAt: string | null;
  resubmit: IndexingResubmit;
  /** Health › Indexing only: adds the header Resubmit all live sites button. */
  resubmitAll?: IndexingResubmitAll;
  /** Site link for the Site column (default the site's Indexing tab). */
  siteHref?: (orgId: string) => string;
}

const SITEMAP_TONE: Record<IndexingSitemapWord, BadgeTone> = {
  ok: "h-ok",
  error: "h-critical",
  unchecked: "h-none",
};

/** Sites Resubmit all touches: live and not the demo org (staffResubmitAllLive). */
export function indexingLiveCount(rows: readonly IndexingRowView[]): number {
  return rows.filter((r) => r.live && !r.demo).length;
}

/** "2 Oct · logged (stand-in)", or "Never". */
export function indexingPingText(r: IndexingRowView): string {
  const day = formatIndexingDay(r.lastPingAt);
  if (!day) return C.ping.never;
  return r.lastPingResult ? `${day} · ${C.ping[r.lastPingResult]}` : day;
}

function defaultSiteHref(orgId: string): string {
  return `/staff/sites/${orgId}?tab=indexing`;
}

export function IndexingTable({
  rows,
  lastRunAt,
  resubmit,
  resubmitAll,
  siteHref = defaultSiteHref,
}: IndexingTableProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const runOne = useStaffAction(resubmit, {
    describe: ([orgId]) =>
      C.resubmitLabel(rows.find((r) => r.orgId === orgId)?.business ?? orgId),
  });
  const runAll = useStaffAction(resubmitAll ?? noAll, {
    describe: () => C.resubmitAll,
  });
  const live = indexingLiveCount(rows);
  const dialog = P13_DIALOGS.resubmit_all;
  const lastRun = formatIndexingDay(lastRunAt);

  async function onResubmit(r: IndexingRowView) {
    setBusy(r.orgId);
    try {
      const res = await runOne(r.orgId);
      if (res.ok) toast.show({ message: res.data.message });
      // WR-E11: a stopped step-up or an ended session says nothing.
      else if (
        res.message &&
        res.code !== "step_up_needed" &&
        res.code !== "session_ended"
      ) {
        toast.show({ message: res.message });
      }
    } finally {
      setBusy(null);
    }
  }

  const columns: StaffColumn<IndexingRowView>[] = [
    {
      id: "site",
      header: C.cols.site,
      priority: 1,
      stack: true,
      primary: true,
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-semibold">{r.business || r.orgId}</span>
          {r.demo ? <Badge tone="demo">{C.demo}</Badge> : null}
          {r.host ? (
            <span className="text-sm text-hub-ink-muted">{r.host}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "ping",
      header: C.cols.ping,
      priority: 1,
      stack: true,
      nowrap: true,
      cell: (r) => (
        <span title={formatIndexingTime(r.lastPingAt) ?? undefined}>
          {indexingPingText(r)}
        </span>
      ),
    },
    {
      id: "sitemap",
      header: C.cols.sitemap,
      priority: 1,
      stack: true,
      cell: (r) => (
        <Badge tone={SITEMAP_TONE[r.sitemapStatus]}>
          {C.sitemap[r.sitemapStatus]}
        </Badge>
      ),
    },
    {
      id: "pages",
      header: C.cols.pages,
      priority: 3,
      align: "end",
      cell: (r) =>
        r.pagesIndexed === null ? (
          <span title={C.pagesTitle}>{C.none}</span>
        ) : (
          <span className="tabular-nums">{r.pagesIndexed}</span>
        ),
    },
    {
      id: "resubmitted",
      header: C.cols.resubmit,
      priority: 2,
      nowrap: true,
      cell: (r) => (
        <span title={formatIndexingTime(r.lastResubmitAt) ?? undefined}>
          {formatIndexingDay(r.lastResubmitAt) ?? C.none}
        </span>
      ),
    },
    {
      id: "action",
      header: C.cols.action,
      priority: 1,
      stack: true,
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCw aria-hidden size={16} strokeWidth={2} />}
          aria-label={C.resubmitLabel(r.business || r.orgId)}
          loading={busy === r.orgId}
          disabled={busy !== null && busy !== r.orgId}
          onClick={() => void onResubmit(r)}
        >
          {C.resubmitNow}
        </Button>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-4 font-hub text-hub-ink">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-semibold">{C.heading}</h2>
          <p className="text-sm text-hub-ink-muted">{C.schedule(lastRun)}</p>
        </div>
        {resubmitAll ? (
          <div className="ml-auto">
            <Button
              variant="secondary"
              disabled={live === 0}
              aria-describedby={live === 0 ? "indexing-no-live" : undefined}
              onClick={() => setConfirming(true)}
            >
              {C.resubmitAll}
            </Button>
            {live === 0 ? (
              <span
                id="indexing-no-live"
                className="ml-2 text-sm text-hub-ink-muted"
              >
                {C.noLiveSites}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">{C.empty}</p>
      ) : (
        <StaffTable
          caption={C.caption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.orgId}
          rowLabel={(r) => r.business || r.orgId}
          primaryHref={(r) => siteHref(r.orgId)}
          shortcutsEnabled={false}
        />
      )}
      {confirming && resubmitAll ? (
        <CaseDialog
          open
          onClose={() => setConfirming(false)}
          title={fillCopy(dialog.title, { count: live })}
          consequence={dialog.body || C.demoSkipped}
          caseRows={[[C.liveSites, String(live)]]}
          confirmLabel={dialog.confirm}
          safeLabel={dialog.safe}
          onConfirm={async () => {
            const res = await runAll();
            if (res.ok) toast.show({ message: res.data.message });
            return res;
          }}
        />
      ) : null}
    </section>
  );
}

async function noAll(): Promise<StaffActionResult<{ message: string }>> {
  return { ok: false, code: "invalid_input", message: "" };
}
