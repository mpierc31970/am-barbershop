// Panel sites/[org]/domain: filled by 14-51
// Panel sites/[org]/domain (14-51 choice 1; DOM-08, DOM-05, D169, D-UI-P14-17; 14-UI-SPEC
// "Staff › Site › Domain"). Reads staffDomainView once per request (React cache, shared with
// the page's "Domain · 1" count) and renders the 14-38 components: PostSwitchAlert on top,
// then the grid (DomainSummary first in the DOM, xl:order-last: it is the open <details>
// below 1280px) with MoveTimeline and the GateReport. A failed read logs the class name only.
import { staffDomainView, type StaffDomainView } from "@cds/db";
import {
  DomainSummary,
  GateReport,
  MoveDomainButton,
  MoveTimeline,
  PostSwitchAlert,
  type StaffDomainMoveData,
} from "@cds/ui/staff";
import { cache } from "react";
import {
  addZoneFileAction,
  cancelMoveAction,
  overrideGateAction,
  rerunPostSwitchAction,
  retakeSnapshotAction,
  retryStepAction,
  startMoveAction,
} from "../../../../../../actions/staff/domains";
import type { PlatformContext } from "@cds/db";
import { staffCan } from "../../../../../../../lib/staff-session";
import type { StaffSitePanelProps } from "../../../StaffAreaPage";
import { SitesLoadError } from "../../SitesLoadError";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** One staffDomainView per request (panel + tab count); null when the read failed. */
export const readStaffDomainView = cache(
  async (
    ctx: PlatformContext,
    orgId: string,
  ): Promise<StaffDomainView | null> => {
    try {
      return await staffDomainView(ctx, orgId);
    } catch (err) {
      console.error("[staff] site domain read failed", errName(err));
      return null;
    }
  },
);

/**
 * "Domain · 1": the open move has a failed step, or a failing gate rule waits on a staff
 * Override decision (pending override). Never a wrong count: no view, no badge.
 */
export function staffDomainAttention(view: StaffDomainView | null): number {
  const move = view?.move;
  if (!move) return 0;
  // WR-D03: only a move still failed counts; a cancelled move keeps its failedStep.
  if (move.failedStep && move.status === "failed") return 1;
  const open = !["done", "failed", "cancelled"].includes(move.status);
  if (
    open &&
    view.gate?.rules.some((r) => r.result === "fail" && r.overridable)
  ) {
    return 1;
  }
  return 0;
}

/** MoveView as plain timeline data (findings, overrides and acks stay on the server). */
function moveData(view: StaffDomainView): StaffDomainMoveData | null {
  const m = view.move;
  if (!m) return null;
  return {
    code: m.code,
    kind: m.kind,
    fromHost: m.fromHost,
    toHost: m.toHost,
    status: m.status,
    currentStep: m.currentStep,
    steps: m.steps.map((s) => ({
      key: s.key,
      status: s.status,
      ...(s.startedAt ? { startedAt: s.startedAt } : {}),
      ...(s.finishedAt ? { finishedAt: s.finishedAt } : {}),
      ...(s.detail ? { detail: s.detail } : {}),
      ...(typeof s.attempts === "number" ? { attempts: s.attempts } : {}),
    })),
    failedStep: m.failedStep,
    prepared: m.prepared,
    cancelNote: m.cancelNote,
  };
}

export default async function Panel({ session, orgId }: StaffSitePanelProps) {
  const view = await readStaffDomainView(session.ctx, orgId);
  if (!view)
    return <SitesLoadError href={`/staff/sites/${orgId}?tab=domain`} />;
  const canSuper = staffCan(session.role, "domain_move");
  const canOverride = staffCan(session.role, "domain_override");
  const domain = view.summary.domain ?? view.move?.toHost ?? "";
  const hasCustomPrimary = view.hosts.some(
    (h) => h.primary && h.kind === "custom",
  );
  return (
    <div className="flex flex-col gap-6" data-staff-domain="">
      <PostSwitchAlert
        orgId={orgId}
        open={view.postSwitch.open}
        records={view.postSwitch.records}
        rerun={rerunPostSwitchAction}
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="xl:order-last">
          <DomainSummary summary={view.summary} hosts={view.hosts} />
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <MoveTimeline
            orgId={orgId}
            business={view.business}
            move={moveData(view)}
            canSuper={canSuper}
            actions={{
              retry: retryStepAction,
              retake: retakeSnapshotAction,
              addZoneFile: addZoneFileAction,
              cancel: cancelMoveAction,
            }}
            moveDomain={
              <MoveDomainButton
                orgId={orgId}
                business={view.business}
                currentDomain={view.summary.domain ?? ""}
                canSuper={canSuper}
                live={view.live && hasCustomPrimary}
                action={startMoveAction}
              />
            }
          />
          {domain ? (
            <GateReport
              mode="forward"
              orgId={orgId}
              domain={domain}
              gate={view.gate}
              canSuper={canOverride}
              override={overrideGateAction}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
