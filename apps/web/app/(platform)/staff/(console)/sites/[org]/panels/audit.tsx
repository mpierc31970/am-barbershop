// Panel sites/[org]/audit: filled by 13-33
// Panel sites/[org]/audit (13-33 choice 3; STAFF-02, Invariant 10; 13-UI-SPEC site detail
// "Audit" lines 798-799). The tenant's audit log through `staffListAuditLog` (no ip, no email),
// newest first, 50 per page, filter `who` = all · cds (console + impersonation rows) ·
// impersonation; actor "CDS · Name" for staff rows. URL params `who`, `page`; read-only.
import {
  STAFF_AUDIT_FILTERS,
  staffListAuditLog,
  type StaffAuditFilter,
  type StaffAuditPage,
} from "@cds/db";
import { SiteAuditTable } from "@cds/ui/staff";
import type { StaffSitePanelProps } from "../../../StaffAreaPage";
import { SitesLoadError } from "../../SitesLoadError";
import { auditActor } from "./overview";

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseAuditParams(params: StaffSitePanelProps["params"]): {
  who: StaffAuditFilter;
  page: number;
} {
  const rawWho = one(params.who);
  const who = (STAFF_AUDIT_FILTERS as readonly string[]).includes(rawWho)
    ? (rawWho as StaffAuditFilter)
    : "all";
  const n = Number.parseInt(one(params.page), 10);
  const page = Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 1;
  return { who, page };
}

function href(orgId: string, who: StaffAuditFilter, page = 1): string {
  const qs = new URLSearchParams({ tab: "audit" });
  if (who !== "all") qs.set("who", who);
  if (page > 1) qs.set("page", String(page));
  return `/staff/sites/${orgId}?${qs.toString()}`;
}

export default async function Panel({
  session,
  orgId,
  params,
}: StaffSitePanelProps) {
  const { who, page } = parseAuditParams(params);
  let res: StaffAuditPage;
  try {
    res = await staffListAuditLog(session.ctx, orgId, {
      page,
      perPage: 50,
      who,
    });
  } catch (err) {
    console.error(
      "[staff] site audit failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href={`/staff/sites/${orgId}?tab=audit`} />;
  }
  const totalPages = Math.max(1, res.totalPages);
  return (
    <SiteAuditTable
      who={who}
      page={res.page}
      totalPages={totalPages}
      hrefFor={{
        all: href(orgId, "all"),
        cds: href(orgId, "cds"),
        impersonation: href(orgId, "impersonation"),
      }}
      newerHref={res.page > 1 ? href(orgId, who, res.page - 1) : null}
      olderHref={res.page < totalPages ? href(orgId, who, res.page + 1) : null}
      rows={res.items.map((r) => ({
        id: r.id,
        when: r.created,
        actor: auditActor(r),
        action: r.action,
        target: r.targetCollection
          ? `${r.targetCollection}${r.targetId ? ` · ${r.targetId}` : ""}`
          : "",
      }))}
    />
  );
}
