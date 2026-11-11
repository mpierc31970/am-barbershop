// Panel pipeline/launch: filled by 13-34
// Panel pipeline/launch (13-34 choice 5; STAFF-03, D-UI-P13-9, P13-P11; 13-UI-SPEC "Launch"
// lines 666-677; T-13-34-03). One row per ready_for_review site from `staffLaunchQueue`: the
// informational LaunchChecklist ("(owner review arrives in P14)"), open change requests (links
// to the tickets), in review since, View preview and a per-row primary "Approve launch" →
// CaseDialog "Make {business} live?" (+ "Launch anyway" when change requests are open) →
// approveLaunchAction through useStaffAction (super_admin + step-up on the server; agents see
// SUPER-ONLY). The row leaves the list on success. A failed read logs the class name only.
// 14-36 (D26; 14-UI-SPEC "Pipeline › Launch"): the checklist is the owner's real review; each
// row adds the Domain column (move state, `m-*` badges) and Approve launch is aria-disabled
// with APPROVE_BLOCKED unless the owner's review is sent and the move is Prepared; the dialog
// body is APPROVE_B. Approving starts the move's cutover (steps 6-10); a failed cutover keeps
// the site here, in review on its preview address, with "Failed · step n" shown to staff only.
import { P14_COPY } from "@cds/core/dns";
import { staffLaunchQueue, type StaffLaunchRow } from "@cds/db";
import { PIPELINE_COPY } from "@cds/ui/staff";
import { staffCan } from "../../../../../../lib/staff-session";
import { approveLaunchAction } from "../../../../../actions/staff/pipeline";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { LaunchItem, type LaunchView } from "../PipelineActions";

const C = PIPELINE_COPY.launch;

/** The approve-action refusal words, mirrored so the button never promises more (14-36). */
function approveBlocked(r: StaffLaunchRow): string | null {
  if (!r.review.submittedAt) return "The owner hasn't sent the review yet.";
  // CR-D01: pages changed after Ready to launch make the send stale, as on /hub/review.
  if (r.review.resubmitNeeded.length > 0) {
    return P14_COPY.APPROVE_RESEND({ count: r.review.resubmitNeeded.length });
  }
  if (r.move.state === "none") {
    return "Connect a domain first: the site has no domain.";
  }
  if (r.move.state !== "prepared") {
    return P14_COPY.APPROVE_BLOCKED({
      waitingOn: r.move.waitingOn ?? "the move is not prepared",
    });
  }
  return null;
}

function toView(r: StaffLaunchRow): LaunchView {
  return {
    orgId: r.orgId,
    name: r.name,
    checklist: {
      items: r.checklist.items,
      done: r.checklist.done,
      total: r.checklist.total,
      informational: r.checklist.informational,
      note: r.checklist.note,
    },
    move: {
      code: r.move.code,
      state: r.move.state,
      ...(r.move.failedStep ? { failedStep: r.move.failedStep } : {}),
      ...(r.move.domain ? { domain: r.move.domain } : {}),
    },
    reviewSent:
      r.review.submittedAt !== null && r.review.resubmitNeeded.length === 0,
    approveBlocked: approveBlocked(r),
    approveBody: P14_COPY.APPROVE_B({
      business: r.name || r.orgId,
      domain: r.move.domain ?? "",
    }),
    openChangeTickets: r.openChangeTickets,
    openChangeTicketNumbers: r.openChangeTicketNumbers,
    inReviewSince: r.inReviewSince,
    previewUrl: r.previewUrl,
  };
}

export default async function Panel({ session }: StaffPanelProps) {
  let rows: StaffLaunchRow[];
  try {
    rows = await staffLaunchQueue(session.ctx);
  } catch (err) {
    console.error(
      "[staff] launch queue read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href="/staff/pipeline?tab=launch" />;
  }
  if (rows.length === 0) {
    return (
      <p className="py-6 font-hub text-base text-hub-ink-muted">{C.empty}</p>
    );
  }
  const now = new Date().toISOString();
  const canLaunch = staffCan(session.role, "org_stage");
  return (
    <ul
      aria-label={C.caption}
      className="flex flex-col gap-3 font-hub text-hub-ink"
    >
      {rows.map((r) => (
        <LaunchItem
          key={r.orgId}
          row={toView(r)}
          now={now}
          canLaunch={canLaunch}
          approve={approveLaunchAction}
        />
      ))}
    </ul>
  );
}
