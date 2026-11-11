// Panel sites/[org]/offboarding: filled by 14-43
// Panel sites/[org]/offboarding (14-43 choices 1-4; LIFE-01, D282, D58, P14-P13; 14-UI-SPEC
// "Staff › Offboarding"). Reads staffOffboardingView (14-40: the notice with its owner and
// system steps, the DNS handback per zone, the Start case) and maps it to the plain data the
// OffboardingPanel renders: the handback check of each zone becomes a reverse GateReport
// (CDS zone records vs whether the destination answered them; values only, never tokens).
// Start / Cancel offboarding are super_admin (staffCan "offboard"; step-up on the server);
// Re-run handback check is both roles. A failed read logs the class name only.
import {
  GATE_RULE_NAMES,
  classifyRecord,
  recordKey,
  type DnsRecord,
} from "@cds/core/dns";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  staffOffboardingView,
  type HandbackZoneView,
  type StaffOffboardingView,
} from "@cds/db";
import {
  OffboardingPanel,
  type GateReportData,
  type StaffGateRecordGroup,
  type StaffHandbackZoneData,
  type StaffOffboardingPanelView,
  type StaffOffboardingStartCase,
} from "@cds/ui/staff";
import {
  cancelOffboardingAction,
  rerunHandbackAction,
  startOffboardingAction,
} from "../../../../../../actions/staff/offboarding";
import { staffCan } from "../../../../../../../lib/staff-session";
import type { StaffSitePanelProps } from "../../../StaffAreaPage";
import { SitesLoadError } from "../../SitesLoadError";

const BLOCKED = {
  demo: "The demo site can't leave CDS.",
  closed: "This site is already closed.",
  leaving: "Leaving CDS has already started.",
} as const;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function valueText(r: DnsRecord): string {
  return typeof r.priority === "number" ? `${r.priority} ${r.value}` : r.value;
}

/**
 * The handback check as a reverse gate report: one row per record to copy exactly, Original =
 * the CDS zone value, Copy = the same value when the destination answered it. Null before the
 * first check (no results yet).
 */
export function reverseGate(z: HandbackZoneView): GateReportData | null {
  const checkedAt = z.results.length > 0 ? z.checkedAt : null;
  return checkedAt ? gateOf(z, checkedAt) : null;
}

function gateOf(z: HandbackZoneView, checkedAt: string): GateReportData {
  const found = new Map(z.results.map((r) => [recordKey(r.record), r.found]));
  const records = z.groups.copy_exactly.map((r) => {
    const ok = found.get(recordKey(r)) === true;
    const cls = classifyRecord(r, z.domain);
    const group: StaffGateRecordGroup =
      cls === "email" || cls === "verification" || cls === "site"
        ? cls
        : "other";
    const value = valueText(r);
    return {
      group,
      type: r.type,
      name: r.name,
      original: value,
      copy: ok ? value : null,
      sources: [...(r.sources ?? [])],
      result: ok ? ("match" as const) : ("missing" as const),
    };
  });
  const allFound = records.every((r) => r.result === "match");
  return {
    rules: [
      {
        rule: "G1",
        name: GATE_RULE_NAMES.G1,
        result: allFound ? "pass" : "fail",
        hardBlock: false,
        overridable: false,
      },
    ],
    records,
    snapshotAt: checkedAt,
    recordCount: records.length,
    readBackFrom: z.destinationNameservers[0] ?? null,
  };
}

export function startCase(v: StaffOffboardingView): StaffOffboardingStartCase {
  const blocked = v.demo
    ? BLOCKED.demo
    : v.closed || v.offboarding?.status === "closed"
      ? BLOCKED.closed
      : v.offboarding?.status === "notice"
        ? BLOCKED.leaving
        : null;
  return {
    noticeWouldEnd: v.noticeWouldEnd,
    handbackNeeded: v.handbackNeeded,
    blocked,
  };
}

/** StaffOffboardingView -> the panel's plain data (a cancelled notice reads as "not leaving"). */
export function offboardingPanelView(
  v: StaffOffboardingView,
  timeZone: string = BUSINESS_TIME_ZONE,
): StaffOffboardingPanelView {
  const o = v.offboarding;
  const running = o && o.status !== "cancelled" ? o : null;
  const handback: StaffHandbackZoneData[] = v.handback.zones.map((z) => ({
    domain: z.domain,
    status: z.status,
    destination: z.destination,
    gate: reverseGate(z),
  }));
  return {
    orgId: v.orgId,
    business: v.business || v.orgId,
    start: startCase(v),
    offboarding: running
      ? {
          status: running.status,
          requestedAt: running.requestedAt,
          requestedByKind: running.requestedByKind,
          noticeEndsAt: running.noticeEndsAt,
          daysLeft: running.daysLeft,
          reasonCategory: running.reasonCategory,
          note: running.note,
          cancelledAt: running.cancelledAt,
          closedAt: running.closedAt,
          handbackOverdueAt: running.handbackOverdueAt,
          steps: running.steps.map((s) => ({ ...s })),
          systemSteps: (running.systemSteps ?? []).map((s) => ({ ...s })),
        }
      : null,
    lastCancelledAt: o?.status === "cancelled" ? o.cancelledAt : null,
    handback,
    timeZone,
  };
}

export default async function Panel({ session, orgId }: StaffSitePanelProps) {
  let view: StaffOffboardingView;
  try {
    view = await staffOffboardingView(session.ctx, orgId);
  } catch (err) {
    console.error("[staff] site offboarding read failed", errName(err));
    return <SitesLoadError href={`/staff/sites/${orgId}?tab=offboarding`} />;
  }
  return (
    <OffboardingPanel
      view={offboardingPanelView(view)}
      canOffboard={staffCan(session.role, "offboard")}
      actions={{
        start: startOffboardingAction,
        cancel: cancelOffboardingAction,
        rerunHandback: rerunHandbackAction,
      }}
    />
  );
}
