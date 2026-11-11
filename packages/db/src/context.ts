// Branded contexts (Invariant 1, TEN-02, D5). A TypeScript brand stops accidents; the
// module-private WeakSets stop casts: only objects minted here pass the asserts. Minting is
// internal to @cds/db (never re-exported from index.ts); plan 06 mints from real sign-ins.
import {
  InvalidContext,
  NotFound,
  type OrgRole,
  type StaffRole,
} from "@cds/core";

declare const ORG: unique symbol;
declare const PLATFORM: unique symbol;
declare const SYSTEM: unique symbol;

export type OrgContextInput = {
  orgId: string;
  actor: string;
  role: OrgRole;
  grants: readonly string[];
  /** Staff user id when a CDS staff member is impersonating (TEN-08, D98). */
  impersonator?: string;
  /**
   * A CDS system job acting for the org (the assembly queue and sweep, WR-A07). Its audit
   * rows name no user (actor and impersonator empty, `meta.job` set) and its versions read
   * as CDS's, never as the member in `actor`.
   */
  systemJob?: string;
  ip: string;
};
export type OrgContext = Readonly<OrgContextInput> & { readonly [ORG]: true };

export type PlatformContextInput = {
  actor: string;
  staffRole: StaffRole;
  ip: string;
};
export type PlatformContext = Readonly<PlatformContextInput> & {
  readonly [PLATFORM]: true;
};

export type SystemContextInput = { job: string };
export type SystemContext = Readonly<SystemContextInput> & {
  readonly [SYSTEM]: true;
};

const orgMinted = new WeakSet<object>();
const platformMinted = new WeakSet<object>();
const systemMinted = new WeakSet<object>();

export function mintOrgContext(v: OrgContextInput): OrgContext {
  const base = {
    orgId: v.orgId,
    actor: v.actor,
    role: v.role,
    grants: Object.freeze([...v.grants]),
    ip: v.ip,
  };
  const ctx = Object.freeze({
    ...base,
    ...(v.impersonator ? { impersonator: v.impersonator } : {}),
    ...(v.systemJob ? { systemJob: v.systemJob } : {}),
  }) as unknown as OrgContext;
  orgMinted.add(ctx);
  return ctx;
}

export function mintPlatformContext(v: PlatformContextInput): PlatformContext {
  const ctx = Object.freeze({
    actor: v.actor,
    staffRole: v.staffRole,
    ip: v.ip,
  }) as unknown as PlatformContext;
  platformMinted.add(ctx);
  return ctx;
}

export function mintSystemContext(v: SystemContextInput): SystemContext {
  const ctx = Object.freeze({ job: v.job }) as unknown as SystemContext;
  systemMinted.add(ctx);
  return ctx;
}

function isObject(v: unknown): v is object {
  return typeof v === "object" && v !== null;
}

export function assertOrgContext(ctx: unknown): asserts ctx is OrgContext {
  if (!isObject(ctx) || !orgMinted.has(ctx)) {
    throw new InvalidContext("organization context was not minted by @cds/db");
  }
}

export function assertPlatformContext(
  ctx: unknown,
): asserts ctx is PlatformContext {
  if (!isObject(ctx) || !platformMinted.has(ctx)) {
    throw new InvalidContext("platform context was not minted by @cds/db");
  }
}

export function assertSystemContext(
  ctx: unknown,
): asserts ctx is SystemContext {
  if (!isObject(ctx) || !systemMinted.has(ctx)) {
    throw new InvalidContext("system context was not minted by @cds/db");
  }
}

export function isOrgContext(ctx: unknown): ctx is OrgContext {
  return isObject(ctx) && orgMinted.has(ctx);
}

export function isPlatformContext(ctx: unknown): ctx is PlatformContext {
  return isObject(ctx) && platformMinted.has(ctx);
}

/**
 * P14-P34 (14-22 choice 0): the org an owner-callable function acts on. An OrgContext always
 * resolves to its own `ctx.orgId`; naming a different org is `NotFound` (the same answer as a
 * missing row, so ids cannot be probed). Only a Platform or System context may name another
 * org, and then the id is required.
 */
export function scopedOrgId(
  ctx: OrgContext | PlatformContext | SystemContext,
  orgId?: string,
): string {
  if (isOrgContext(ctx)) {
    if (orgId !== undefined && orgId !== ctx.orgId) throw new NotFound();
    return ctx.orgId;
  }
  if (!isPlatformContext(ctx)) assertSystemContext(ctx);
  if (typeof orgId !== "string" || !/^[a-z0-9]{1,64}$/i.test(orgId)) {
    throw new NotFound();
  }
  return orgId;
}
