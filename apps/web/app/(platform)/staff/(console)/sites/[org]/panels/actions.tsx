// Panel sites/[org]/actions: filled by 13-43
// Panel sites/[org]/actions (13-43 choice 1; STAFF-06 entry, STAFF-19, STAFF-22; 13-UI-SPEC site
// detail "Actions" line 791; T-13-43-01..04). Reads the site (staffGetSite: name, suspension,
// demo), its stage (staffOrgStage) and its pages and active add-ons for the ticket About
// select (staffWindowTargets; a failed read leaves Whole site only), computes the fix-by a
// notice sent now would get (suspensionFixBy), and hands SiteActions the gated server calls:
// startImpersonationAction (13-26), staffOpenTicketAction (13-28), postToSiteAction + the
// document route (13-43), moveStageAction (13-27) and the 13-43 suspension actions. Role
// gating here is presentation; every action re-checks the matrix and step-up on the server.
// 14-43 choice 3: the Leaving CDS row (Start offboarding, super_admin + step-up) reads
// staffOffboardingView for its case; a failed read hides the row (logged by class name).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { buildTargetOptions, type TargetGroup } from "@cds/core/support";
import {
  staffGetSite,
  staffOffboardingView,
  staffOrgStage,
  staffWindowTargets,
  suspensionFixBy,
  type StaffSiteDetail,
  type StaffSiteSuspension,
} from "@cds/db";
import {
  SiteActions,
  type SiteActionsSuspension,
  type SiteActionsView,
} from "@cds/ui/staff";
import { staffCan } from "../../../../../../../lib/staff-session";
import { startImpersonationAction } from "../../../../../../actions/staff/impersonation";
import { startOffboardingAction } from "../../../../../../actions/staff/offboarding";
import { moveStageAction } from "../../../../../../actions/staff/pipeline";
import { postToSiteAction } from "../../../../../../actions/staff/sites";
import {
  liftSuspensionAction,
  markFixedAction,
  sendNoticeAction,
  suspendNowAction,
} from "../../../../../../actions/staff/suspension";
import { staffOpenTicketAction } from "../../../../../../actions/staff/tickets";
import type { StaffSitePanelProps } from "../../../StaffAreaPage";
import { SitesLoadError } from "../../SitesLoadError";
import { startCase } from "./offboarding";

const REASON_PREFILL_MAX = 500;
/** The stored stages in forward order (@cds/db ORG_STAGES; not in the root barrel). */
const ORG_STAGES = [
  "intake",
  "fit_review",
  "ready_for_build",
  "being_built",
  "ready_for_review",
  "live",
] as const;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** none / notice (open: not fixed, not lifted) / suspended. */
export function actionsSuspension(
  s: StaffSiteSuspension | null,
): SiteActionsSuspension {
  if (!s) return { state: "none" };
  if (s.suspendedAt) {
    return {
      state: "suspended",
      suspendedAt: s.suspendedAt,
      category: s.category,
    };
  }
  if (s.mode === "notice" && !s.fixedAt && !s.liftedAt && s.fixBy) {
    return { state: "notice", fixBy: s.fixBy, category: s.category };
  }
  return { state: "none" };
}

/**
 * Stages after the current one, never fit_review (Approve / Decline fit decides that) and never
 * live (Approve launch in the pipeline is the one gated path to live, WR-C03).
 */
export function forwardStages(stage: string): string[] {
  if (stage === "fit_review" || stage === "live") return [];
  const all = ORG_STAGES as readonly string[];
  const at = all.indexOf(stage);
  return all.slice(at + 1).filter((s) => s !== "fit_review" && s !== "live");
}

/** `?reason=Ticket #1042` (13-35 openAsAdminHref), trimmed and capped; "" when absent. */
export function reasonPrefill(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, REASON_PREFILL_MAX);
}

export default async function Panel({
  session,
  orgId,
  params,
}: StaffSitePanelProps) {
  let site: StaffSiteDetail;
  let stage: string;
  try {
    const [detail, st] = await Promise.all([
      staffGetSite(session.ctx, orgId),
      staffOrgStage(session.ctx, orgId),
    ]);
    site = detail;
    stage = st.stage;
  } catch (err) {
    console.error("[staff] site actions failed", errName(err));
    return <SitesLoadError href={`/staff/sites/${orgId}?tab=actions`} />;
  }

  let targets: TargetGroup[] = buildTargetOptions({ pages: [], addons: [] });
  try {
    const t = await staffWindowTargets(session.ctx, orgId);
    targets = buildTargetOptions({
      pages: t.pages.map((p) => ({ id: p.id, title: p.title })),
      addons: t.activeAddons.map((slug) => ({
        slug,
        name: ADDON_REGISTRY.get(slug)?.name ?? slug,
      })),
    });
  } catch (err) {
    // The ticket still opens about the whole site.
    console.error("[staff] site targets read failed", errName(err));
  }

  let offboarding: SiteActionsView["offboarding"];
  try {
    const off = await staffOffboardingView(session.ctx, orgId);
    offboarding = {
      start: startCase(off),
      leaving: off.offboarding?.status === "notice",
      href: `/staff/sites/${orgId}?tab=offboarding`,
    };
  } catch (err) {
    // The row hides; the Offboarding tab shows the read error itself.
    console.error("[staff] site offboarding case failed", errName(err));
  }

  const role = session.role;
  return (
    <SiteActions
      view={{
        orgId,
        business: site.name || orgId,
        timeZone: BUSINESS_TIME_ZONE,
        stage,
        forwardStages: forwardStages(stage),
        suspension: actionsSuspension(site.suspension),
        demo: site.demo,
        noticeFixBy: suspensionFixBy(new Date()).toISOString(),
        targets,
        reasonPrefill: reasonPrefill(params.reason),
        documentHref: `/staff/api/sites/${orgId}/document`,
        addonsHref: `/staff/sites/${orgId}?tab=addons`,
        ...(offboarding ? { offboarding } : {}),
      }}
      can={{
        // The owner view is super_admin only (13-26 refuses it for agents too); one matrix
        // key gates both (WR-D08).
        ownerView: staffCan(role, "impersonate_owner"),
        stage: staffCan(role, "org_stage"),
        suspendNow: staffCan(role, "suspend_now"),
        lift: staffCan(role, "suspend_lift"),
        offboard: staffCan(role, "offboard"),
      }}
      actions={{
        startImpersonation: startImpersonationAction,
        openTicket: staffOpenTicketAction,
        post: postToSiteAction,
        moveStage: moveStageAction,
        sendNotice: sendNoticeAction,
        suspendNow: suspendNowAction,
        markFixed: markFixedAction,
        liftSuspension: liftSuspensionAction,
        startOffboarding: startOffboardingAction,
      }}
    />
  );
}
