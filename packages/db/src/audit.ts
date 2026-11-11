// Audit log (TEN-08, TEN-15; D98). Append-only: nothing in @cds/db updates or deletes an
// audit_log row. auditBody() builds the row for any context; the repository puts it in the
// same PB batch as an impersonated write so no unaudited write can commit.
import { authorize, InvalidContext, InvalidInput } from "@cds/core";
import { AUDIT_LOG_RETENTION_DAYS } from "@cds/core/legal";
import type { ListResult, RecordModel } from "pocketbase";
import { withSuperuser } from "./client";
import {
  assertOrgContext,
  assertSystemContext,
  isOrgContext,
  isPlatformContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "./context";

/**
 * TEN-15 retention contract, read from the one retention table (CONTEXT A4-Q1): audit rows
 * are kept AUDIT_LOG_RETENTION_DAYS; jobs/retention.ts deletes older ones (09-12).
 */
export { AUDIT_LOG_RETENTION_DAYS };

export type AuditEvent = {
  action: string;
  /** Only honoured for platform/system contexts; an org context always writes its own org and a different value throws InvalidInput (TEN-03). */
  organization?: string | null;
  targetCollection?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
};

export type AuditBody = {
  organization: string;
  actor: string;
  impersonator: string;
  action: string;
  target_collection: string;
  target_id: string;
  ip: string;
  meta: Record<string, unknown> | null;
};

export function auditBody(
  ctx: OrgContext | PlatformContext | SystemContext,
  e: AuditEvent,
): AuditBody {
  if (!e.action) throw new InvalidContext("audit event needs an action");
  const common = {
    action: e.action,
    target_collection: e.targetCollection ?? "",
    target_id: e.targetId ?? "",
  };
  if (isOrgContext(ctx)) {
    if (
      e.organization !== undefined &&
      e.organization !== null &&
      e.organization !== ctx.orgId
    ) {
      throw new InvalidInput("an audit row cannot name another organization");
    }
    if (ctx.systemJob) {
      // A system run's row is CDS's, never the owner's (WR-A07).
      return {
        ...common,
        organization: ctx.orgId,
        actor: "",
        impersonator: "",
        ip: ctx.ip,
        meta: { ...(e.meta ?? {}), job: ctx.systemJob },
      };
    }
    return {
      ...common,
      organization: ctx.orgId,
      actor: ctx.actor,
      impersonator: ctx.impersonator ?? "",
      ip: ctx.ip,
      meta: e.meta ?? null,
    };
  }
  if (isPlatformContext(ctx)) {
    return {
      ...common,
      organization: e.organization ?? "",
      actor: ctx.actor,
      impersonator: ctx.actor,
      ip: ctx.ip,
      meta: e.meta ?? null,
    };
  }
  assertSystemContext(ctx);
  return {
    ...common,
    organization: e.organization ?? "",
    actor: "",
    impersonator: "",
    ip: "",
    meta: { ...(e.meta ?? {}), job: ctx.job },
  };
}

/** Internal: write one audit row outside any batch. Returns the record id. */
export async function appendAudit(
  ctx: OrgContext | PlatformContext | SystemContext,
  e: AuditEvent,
): Promise<string> {
  const body = auditBody(ctx, e);
  const record = await withSuperuser((pb) =>
    pb.collection("audit_log").create(body),
  );
  return record.id;
}

/** The organization's audit log, newest first (owner/admin, TEN-15). */
export async function listAuditLog(
  ctx: OrgContext,
  opts: { page?: number; perPage?: number } = {},
): Promise<ListResult<RecordModel>> {
  assertOrgContext(ctx);
  authorize(ctx, "audit_log", "read");
  const page = clampInt(opts.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const perPage = clampInt(opts.perPage, 50, 1, 500);
  return withSuperuser((pb) =>
    pb.collection("audit_log").getList(page, perPage, {
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      sort: "-created,-id",
    }),
  );
}

export function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
