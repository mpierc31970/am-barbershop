// Demo flag (13-24; STAFF-18, D293, Invariant 2: a data flag, never a per-tenant code branch).
//   - orgIsDemo(orgId): cached superuser read (5 s TTL, bounded; copy of orgIsLive). The shared
//     choke points read it: sendEmail (drop), paymentsModeFor (fake), screen() and image
//     moderation (clean, no provider, no flag), the save/publish pinger (skip).
//   - setOrgDemoFlag(ctx, orgId, value): the ONLY writer of organizations.demo. Staff need
//     `demo_reset` (super_admin); the production seed (13-31) passes a SystemContext. Audited.
//     No tenant write path accepts `demo` (serverOnly in BROWSER_FIELDS; tenant writers use
//     allowlists).
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertSystemContext,
  isPlatformContext,
  type PlatformContext,
  type SystemContext,
} from "../context";

const ORG_ID = /^[a-z0-9]{15}$/;
const DEMO_TTL_MS = 5_000;
const demoCache = new Map<string, { at: number; demo: Promise<boolean> }>();

/**
 * True when the org is the demo tenant. An unknown or invalid id is not demo; a failed read is
 * not demo (the choke points then behave as for any real org, which is the safe side for scans).
 */
export async function orgIsDemo(orgId: string): Promise<boolean> {
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) return false;
  const now = Date.now();
  const hit = demoCache.get(orgId);
  if (hit && now - hit.at < DEMO_TTL_MS) return hit.demo;
  const demo = withSuperuser((pb) =>
    pb.collection("organizations").getOne(orgId, { fields: "demo" }),
  ).then(
    (row) => row.demo === true,
    () => false,
  );
  demoCache.set(orgId, { at: now, demo });
  if (demoCache.size > 500) {
    for (const [k, v] of demoCache) {
      if (now - v.at >= DEMO_TTL_MS) demoCache.delete(k);
    }
  }
  return demo;
}

/**
 * Set or clear the demo flag on one org (staff `demo_reset`, or a system job such as the demo
 * seed). One batch: the org update and its audit row (`site.demo_flag_set`, tenant-visible).
 */
export async function setOrgDemoFlag(
  ctx: PlatformContext | SystemContext,
  orgId: string,
  value: boolean,
): Promise<void> {
  if (isPlatformContext(ctx)) {
    authorizeStaff(ctx.staffRole, "demo_reset");
  } else {
    assertSystemContext(ctx);
  }
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) {
    throw new InvalidInput("invalid organization id");
  }
  if (typeof value !== "boolean") {
    throw new InvalidInput("demo must be true or false");
  }
  await withSuperuser(async (pb) => {
    await pb
      .collection("organizations")
      .getOne(orgId, { fields: "id" })
      .catch(() => {
        throw new NotFound();
      });
    const batch = pb.createBatch();
    batch.collection("organizations").update(orgId, { demo: value });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "site.demo_flag_set",
        organization: orgId,
        targetCollection: "organizations",
        targetId: orgId,
        meta: { demo: value },
      }),
    );
    await batch.send();
  });
  demoCache.delete(orgId);
}

/** Test seam: clear the orgIsDemo cache. */
export function __clearDemoCacheForTests(): void {
  demoCache.clear();
}
