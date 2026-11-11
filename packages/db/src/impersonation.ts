// Staff impersonation (TEN-08, TEN-15; D10, D98, D287; Invariant 10).
//
// CDS staff never hold tenant access directly: the only way from a PlatformContext into an
// organization is startImpersonation, which
//   - requires a minted PlatformContext (a real MFA sign-in, plan 06) and the staff
//     permission "impersonate" (super_admin, support_agent)
//   - requires a reason (3..500 chars) and an existing organization (else NotFound)
//   - writes the start row to the tenant's own audit_log (reason, view, staff IP) BEFORE
//     the context exists, so the tenant owner sees every session in their audit log
//   - returns an OrgContext carrying `impersonator`: every write under it is batched with an
//     audit row (repository.ts, members.ts), and the IMPERSONATION_DENY list (sign, buy,
//     refund, connect) is checked before any role check (@cds/core authorize)
// View: "admin" by default; the "owner" view is super_admin only (RESEARCH open question 1).
// Audit rows are append-only and kept AUDIT_LOG_RETENTION_DAYS (730); deletion job is LIFE.
import { authorizeStaff, Forbidden, InvalidInput, NotFound } from "@cds/core";
import { ClientResponseError } from "pocketbase";
import { appendAudit } from "./audit";
import { withSuperuser } from "./client";
import {
  assertOrgContext,
  assertPlatformContext,
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "./context";

/** The owner view's matrix key (WR-D08): the same `impersonate_owner` the console checks. */
function ownerViewAllowed(role: PlatformContext["staffRole"]): boolean {
  try {
    authorizeStaff(role, "impersonate_owner");
    return true;
  } catch {
    return false;
  }
}

export type ImpersonationView = "admin" | "owner";

const REASON_MIN = 3;
const REASON_MAX = 500;

function reasonOf(v: unknown): string {
  const r = typeof v === "string" ? v.trim() : "";
  if (r.length < REASON_MIN || r.length > REASON_MAX) {
    throw new InvalidInput(
      `a reason of ${REASON_MIN}-${REASON_MAX} characters is required`,
    );
  }
  return r;
}

async function assertOrgExists(orgId: unknown): Promise<string> {
  if (typeof orgId !== "string" || !/^[a-z0-9]{1,64}$/i.test(orgId)) {
    throw new NotFound();
  }
  await withSuperuser(async (pb) => {
    try {
      await pb.collection("organizations").getOne(orgId, { fields: "id" });
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound();
      }
      throw err;
    }
  });
  return orgId;
}

/** How long one impersonation session lasts (P13-P4): resume refuses after this. */
export const IMPERSONATION_SESSION_MS = 60 * 60 * 1000;

export type ImpersonationSession = {
  ctx: OrgContext;
  /** The impersonation.start audit row id (cookie `startId`, end row `meta.startId`). */
  startId: string;
  startedAt: string;
  expiresAt: string;
};

/**
 * One resumed impersonation request (13-26 choice 4): the context plus what the hub banner
 * shows (business name, reason from the start row, the 60-minute box) and the org's primary
 * host for the hub site card. Read-only.
 */
export type ImpersonationResume = {
  ctx: OrgContext;
  business: string;
  primaryHost: string | null;
  reason: string;
  view: ImpersonationView;
  startId: string;
  startedAt: string;
  expiresAt: string;
};

const ID_RE = /^[a-z0-9]{15}$/;

function nowOf(now?: Date): Date {
  return now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
}

function pbMs(v: unknown): number {
  return typeof v === "string" && v !== ""
    ? Date.parse(v.replace(" ", "T"))
    : Number.NaN;
}

function viewOf(v: unknown): ImpersonationView {
  if (v !== "admin" && v !== "owner") {
    throw new InvalidInput("view must be admin or owner");
  }
  return v;
}

/**
 * Enter an organization as CDS staff (audited once, STAFF-06, P13-P4). Writes the one
 * tenant-visible impersonation.start row and returns its id with the context; later requests
 * re-enter through resumeImpersonation, which writes nothing.
 */
export async function startImpersonationSession(
  pctx: PlatformContext,
  orgId: string,
  reason: string,
  opts: { view?: ImpersonationView; now?: Date } = {},
): Promise<ImpersonationSession> {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole, "impersonate");
  const why = reasonOf(reason);
  const view = viewOf(opts?.view ?? "admin");
  if (view === "owner" && !ownerViewAllowed(pctx.staffRole)) {
    throw new Forbidden("only a super admin may take the owner view");
  }
  const org = await assertOrgExists(orgId);
  const startId = await appendAudit(pctx, {
    action: "impersonation.start",
    organization: org,
    targetCollection: "organizations",
    targetId: org,
    meta: { reason: why, view },
  });
  const started = nowOf(opts?.now);
  return {
    ctx: mintOrgContext({
      orgId: org,
      actor: pctx.actor,
      role: view,
      grants: [],
      impersonator: pctx.actor,
      ip: pctx.ip,
    }),
    startId,
    startedAt: started.toISOString(),
    expiresAt: new Date(
      started.getTime() + IMPERSONATION_SESSION_MS,
    ).toISOString(),
  };
}

/** Enter an organization as CDS staff (audited). Returns the impersonated OrgContext. */
export async function startImpersonation(
  pctx: PlatformContext,
  orgId: string,
  reason: string,
  opts: { view?: ImpersonationView } = {},
): Promise<OrgContext> {
  return (await startImpersonationSession(pctx, orgId, reason, opts)).ctx;
}

/**
 * Re-enter a running impersonation session for one request (P13-P4). Writes nothing; returns
 * the context with the banner facts (13-26). Refuses
 * (Forbidden) unless the start row exists for this org and this staff actor, was written
 * within 60 minutes of `now`, and has no matching impersonation.end row.
 */
export async function resumeImpersonation(
  pctx: PlatformContext,
  input: {
    orgId: string;
    view: ImpersonationView;
    startId: string;
    now?: Date;
  },
): Promise<ImpersonationResume> {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole, "impersonate");
  const orgId = input?.orgId;
  const startId = input?.startId;
  if (
    typeof orgId !== "string" ||
    !ID_RE.test(orgId) ||
    typeof startId !== "string" ||
    !ID_RE.test(startId)
  ) {
    throw new Forbidden("impersonation session not found");
  }
  const view = input.view;
  if (view !== "admin" && view !== "owner") {
    throw new Forbidden("impersonation session not found");
  }
  if (view === "owner" && !ownerViewAllowed(pctx.staffRole)) {
    throw new Forbidden("only a super admin may take the owner view");
  }
  const t = nowOf(input.now).getTime();
  const info = await withSuperuser(async (pb) => {
    const start = await pb.collection("audit_log").getList(1, 1, {
      filter: pb.filter(
        "id = {:id} && action = 'impersonation.start' && organization = {:org} && actor = {:actor}",
        { id: startId, org: orgId, actor: pctx.actor },
      ),
      fields: "id,created,meta",
    });
    const row = start.items[0];
    if (!row) throw new Forbidden("impersonation session not found");
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    if (meta.view !== undefined && meta.view !== view) {
      throw new Forbidden("impersonation session not found");
    }
    const created = pbMs(row.created);
    if (
      Number.isNaN(created) ||
      t - created > IMPERSONATION_SESSION_MS ||
      created - t > 60_000
    ) {
      throw new Forbidden("impersonation session expired");
    }
    const ended = await pb.collection("audit_log").getList(1, 1, {
      filter: pb.filter(
        "action = 'impersonation.end' && organization = {:org} && meta.startId = {:sid}",
        { org: orgId, sid: startId },
      ),
      fields: "id",
    });
    if (ended.items.length > 0) {
      throw new Forbidden("impersonation session ended");
    }
    let business = "";
    try {
      const org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "id,name" });
      business = typeof org.name === "string" ? org.name : "";
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new Forbidden("impersonation session not found");
      }
      throw err;
    }
    const hosts = await pb.collection("org_hosts").getList(1, 1, {
      filter: pb.filter("organization = {:org} && primary = true", {
        org: orgId,
      }),
      fields: "hostname",
    });
    const host = hosts.items[0]?.hostname;
    return {
      business,
      primaryHost:
        typeof host === "string" && host.trim() !== "" ? host.trim() : null,
      reason: typeof meta.reason === "string" ? meta.reason : "",
      created,
    };
  });
  return {
    ctx: mintOrgContext({
      orgId,
      actor: pctx.actor,
      role: view,
      grants: [],
      impersonator: pctx.actor,
      ip: pctx.ip,
    }),
    business: info.business,
    primaryHost: info.primaryHost,
    reason: info.reason,
    view,
    startId,
    startedAt: new Date(info.created).toISOString(),
    expiresAt: new Date(info.created + IMPERSONATION_SESSION_MS).toISOString(),
  };
}

/**
 * Leave an impersonation session (audited). A non-impersonated context is rejected. With
 * `startId` the end row carries `meta.startId`, which closes that session for resume.
 */
export async function endImpersonation(
  ctx: OrgContext,
  opts: { startId?: string } = {},
): Promise<void> {
  assertOrgContext(ctx);
  if (!ctx.impersonator) {
    throw new InvalidInput("this context is not an impersonation session");
  }
  const startId = opts?.startId;
  if (
    startId !== undefined &&
    (typeof startId !== "string" || !ID_RE.test(startId))
  ) {
    throw new InvalidInput("invalid impersonation session id");
  }
  await appendAudit(ctx, {
    action: "impersonation.end",
    targetCollection: "organizations",
    targetId: ctx.orgId,
    ...(startId ? { meta: { startId } } : {}),
  });
}
