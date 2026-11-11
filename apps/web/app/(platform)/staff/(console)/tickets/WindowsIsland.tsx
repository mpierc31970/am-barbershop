"use client";
// Service windows island (13-36 choices 3-4; STAFF-10, D99-D102, D-UI-P13-11; 13-UI-SPEC
// "Service windows" lines 561-583). The list: SegmentedControl Active and scheduled · Ended
// (URL `view=`), a StaffTable (Ref · Scope · When · State · Message · Incident · By) with
// neutral state badges and a per-row ghost End now → CaseDialog "End W-12 now? Editing reopens
// for {target}." (End now · Keep it). The form: WindowForm over createWindowAction /
// windowTargetsAction through useStaffAction, so a platform window asks for a fresh emailed
// code and retries the same call; the result toast is the CLI line. Row types mirror the
// @cds/db read model (client code never imports @cds/db).
import { fillCopy, P13_DIALOGS } from "@cds/core/staff";
import { SegmentedControl, useToast } from "@cds/ui/hub";
import {
  CaseDialog,
  StaffTable,
  WindowForm,
  WindowStateBadge,
  WINDOWS_COPY,
  useStaffAction,
  type StaffColumn,
  type WindowFormProps,
} from "@cds/ui/staff";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  createWindowAction,
  endWindowAction,
  windowTargetsAction,
} from "../../../../actions/staff/windows";

const C = WINDOWS_COPY;

export type WindowRowView = {
  code: string;
  scopeText: string;
  /** "Rivera Bakery · page "About us"" for the End dialog. */
  target: string;
  when: string;
  state: "active" | "scheduled" | "ended";
  message: string;
  incident: string;
  by: string;
  canEnd: boolean;
  /** The site's console page, else the list itself (platform / add-on windows). */
  href: string;
};

export function WindowsList({
  rows,
  view,
}: {
  rows: readonly WindowRowView[];
  view: "current" | "ended";
}) {
  const router = useRouter();
  const toast = useToast();
  const [ending, setEnding] = useState<WindowRowView | null>(null);
  const end = useStaffAction(endWindowAction, {
    describe: ([code]) => C.endNowLabel(String(code)),
  });
  const dialog = P13_DIALOGS.window_end;

  const columns: StaffColumn<WindowRowView>[] = [
    {
      id: "ref",
      header: C.cols.ref,
      cell: (r) => r.code,
      priority: 1,
      primary: true,
      nowrap: true,
      width: "80px",
    },
    {
      id: "scope",
      header: C.cols.scope,
      cell: (r) => r.scopeText,
      priority: 1,
    },
    { id: "when", header: C.cols.when, cell: (r) => r.when, priority: 2 },
    {
      id: "state",
      header: C.cols.state,
      cell: (r) => <WindowStateBadge state={r.state} />,
      priority: 1,
      stack: true,
    },
    {
      id: "message",
      header: C.cols.message,
      cell: (r) => (
        <span className="line-clamp-1 max-w-[28ch]" title={r.message}>
          {r.message || C.none}
        </span>
      ),
      priority: 3,
    },
    {
      id: "incident",
      header: C.cols.incident,
      cell: (r) => r.incident || C.none,
      priority: 4,
      nowrap: true,
    },
    { id: "by", header: C.cols.by, cell: (r) => r.by, priority: 4 },
    {
      id: "action",
      header: C.cols.action,
      cell: (r) =>
        r.state !== "ended" && r.canEnd ? (
          <button
            type="button"
            aria-label={C.endNowLabel(r.code)}
            onClick={() => setEnding(r)}
            className="rounded px-2 py-1 font-semibold text-hub-accent hover:bg-hub-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
          >
            {C.endNow}
          </button>
        ) : (
          C.none
        ),
      priority: 1,
      align: "end",
    },
  ];

  return (
    <div className="flex flex-col gap-4 font-hub text-hub-ink">
      <SegmentedControl
        name="window-view"
        label={C.viewsLabel}
        options={[
          { value: "current", label: C.views.current },
          { value: "ended", label: C.views.ended },
        ]}
        value={view}
        onChange={(v) =>
          router.push(
            v === "ended"
              ? "/staff/tickets?tab=windows&view=ended"
              : "/staff/tickets?tab=windows",
          )
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 text-base text-hub-ink-muted">
          {view === "ended" ? C.emptyEnded : C.empty}
        </p>
      ) : (
        <StaffTable
          caption={C.caption}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.code}
          rowLabel={(r) => r.code}
          primaryHref={(r) => r.href}
          shortcutsEnabled={false}
        />
      )}
      {ending ? (
        <CaseDialog
          open
          onClose={() => setEnding(null)}
          title={fillCopy(dialog.title, { code: ending.code })}
          consequence={fillCopy(dialog.body, { target: ending.target })}
          caseRows={[
            [C.cols.scope, ending.scopeText],
            [C.cols.when, ending.when],
          ]}
          confirmLabel={dialog.confirm}
          safeLabel={dialog.safe}
          onConfirm={async () => {
            const res = await end(ending.code);
            if (res.ok) {
              toast.show({ message: res.data.message });
              router.refresh();
            }
            return res;
          }}
        />
      ) : null}
    </div>
  );
}

export function WindowFormIsland(
  props: Pick<WindowFormProps, "allowed" | "sites" | "addons" | "incidents"> & {
    timeZone: string;
  },
) {
  const router = useRouter();
  const toast = useToast();
  const create = useStaffAction(createWindowAction, {
    describe: () => C.create,
  });
  const loadTargets = useCallback(
    (orgId: string) => windowTargetsAction(orgId),
    [],
  );
  return (
    <WindowForm
      {...props}
      loadTargets={loadTargets}
      onCreate={(input) => create(input)}
      onCreated={(data) => {
        toast.show({ message: data.message });
        router.push("/staff/tickets?tab=windows");
        router.refresh();
      }}
      onDiscard={() => router.push("/staff/tickets?tab=windows")}
    />
  );
}
