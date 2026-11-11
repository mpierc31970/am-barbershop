// Panel sites/[org]/overview: filled by 13-33
// Panel sites/[org]/overview (13-33 choice 3; STAFF-02, D5; 13-UI-SPEC site detail "Overview"
// lines 779-783; T-13-33-02). staffGetSite (row + members by name and role, never an email +
// read-only billing + suspension) and the last 10 audit lines (staffListAuditLog), shown by
// SiteOverview. Failures log the class name only and show ERR-LOAD.
import {
  staffGetSite,
  staffListAuditLog,
  type StaffAuditRow,
  type StaffSiteDetail,
} from "@cds/db";
import { SiteOverview, auditActorLabel } from "@cds/ui/staff";
import type { StaffSitePanelProps } from "../../../StaffAreaPage";
import { SitesLoadError } from "../../SitesLoadError";

const RECENT = 10;

export function auditActor(r: StaffAuditRow): string {
  const meta = r.meta as { job?: unknown } | null;
  return auditActorLabel({
    actorName: r.actorName,
    byStaff: r.byStaff,
    impersonatorName: r.impersonatorName,
    system:
      !r.byStaff &&
      r.actorName === "" &&
      typeof meta?.job === "string" &&
      meta.job !== "",
  });
}

export default async function Panel({ session, orgId }: StaffSitePanelProps) {
  let site: StaffSiteDetail;
  let recent: StaffAuditRow[];
  try {
    [site, recent] = await Promise.all([
      staffGetSite(session.ctx, orgId),
      staffListAuditLog(session.ctx, orgId, { perPage: RECENT }).then(
        (p) => p.items,
      ),
    ]);
  } catch (err) {
    console.error(
      "[staff] site overview failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href={`/staff/sites/${orgId}?tab=overview`} />;
  }
  return (
    <SiteOverview
      auditHref={`/staff/sites/${orgId}?tab=audit`}
      site={{
        orgId: site.orgId,
        name: site.name,
        state: site.state,
        path: site.path,
        plan: site.plan,
        carePlan: site.carePlan,
        liveHost: site.liveHost,
        previewHost: site.previewHost,
        created: site.created,
        demo: site.demo,
        repeatInfringer: site.repeatInfringer,
        billing: {
          state: site.billing.state,
          nextRenewal: site.billing.nextRenewal,
        },
        suspension: site.suspension
          ? {
              mode: site.suspension.mode,
              suspendedAt: site.suspension.suspendedAt,
              fixBy: site.suspension.fixBy,
              fixedAt: site.suspension.fixedAt,
              liftedAt: site.suspension.liftedAt,
            }
          : null,
        // Names and roles only (T-13-33-02).
        members: site.members.map((m) => ({ name: m.name, role: m.role })),
        recent: recent.map((r) => ({
          id: r.id,
          when: r.created,
          actor: auditActor(r),
          action: r.action,
        })),
      }}
    />
  );
}
