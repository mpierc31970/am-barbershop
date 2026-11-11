// The demo reset (13-31; STAFF-18, D293, RESEARCH Pitfall 11). Wipes and reseeds ONLY the demo
// org's tenant rows, keeping its org id, its org_hosts row and its owner (so the preview host
// and every link to it stay stable).
//
//   wipe   for each tenant collection (TENANT_COLLECTIONS plus the registered add-on
//          collections, reverse registry order so children go first; a second pass retries
//          what a reference blocked), delete the rows matching
//          pb.filter("organization = {:org}", { org: demoId }). The org's audit_log, alerts and
//          support rows go too. Kept: org_hosts, the owner's membership, and the legal / payment
//          evidence collections (agreement_signatures, site_policy_acks, billing_invoices,
//          work_orders: a demo has none, and they are never bulk-deleted). The org's private
//          objects under tenants/<org>/ (except exports/ and agreements/) and its public media
//          are removed, so stale published pages never outlive the reset.
//   seed   seedDemoContent with the demo owner's context, then one `demo.reset` audit row and
//          platform_meta `demo:last_reset` (ISO; Settings › Demo tenant reads it, 13-46).
//
// The org is resolved by slug `demo` AND demo = true (findDemoOrgId / ensureDemoOrg refuse any
// other org), so a reset can never be pointed at a real tenant (T-13-31-01). staffResetDemo is
// the console's "Reset now" (super_admin `demo_reset`; the caller action enforces step-up) and
// shares the job's platform lock, so a nightly run and a staff reset never overlap.
import { authorizeStaff, InvalidInput } from "@cds/core";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { siteTag } from "../content/ports";
import {
  assertPlatformContext,
  assertSystemContext,
  isPlatformContext,
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { assertAddonCollectionsRegistered } from "../export";
import {
  acquirePlatformLock,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";
import { allTenantCollections, TENANT_COLLECTIONS } from "../registry";
import {
  envPrefix,
  getObjectStore,
  getPublicMediaStore,
  type ObjectStore,
} from "../storage";
import {
  ensureDemoOrg,
  findDemoOrgId,
  type DemoOrg,
  type DemoSeedDeps,
  seedDemoContent,
} from "./seed";

/** Shared by the nightly job and staff "Reset now". */
export const DEMO_LOCK_KEY = "lock:demo-job";
export const DEMO_LOCK_STALE_MS = 30 * 60_000;
/** ISO of the last finished reset (job or staff). */
export const DEMO_LAST_RESET_KEY = "demo:last_reset";

const PAGE = 200;
/** Never wiped: the host stays stable, evidence is never bulk-deleted. */
const KEPT = new Set<string>([
  "org_hosts",
  "agreement_signatures",
  "site_policy_acks",
  "billing_invoices",
  "work_orders",
]);
/** Private subtrees that are never removed (as in retention). */
const KEPT_PREFIXES = ["agreements/", "exports/"];

export type DemoResetResult = {
  orgId: string;
  rowsDeleted: number;
  rowsSeeded: number;
};

export type DemoResetOptions = DemoSeedDeps & { now?: Date };

/** Which reset step failed (the job names it in failedSteps); the cause is kept, never logged. */
export class DemoResetStepError extends Error {
  readonly step: "wipe" | "seed";
  readonly rowsDeleted: number;
  constructor(step: "wipe" | "seed", rowsDeleted: number, cause: unknown) {
    super(`demo reset ${step} failed`, { cause });
    this.name = "DemoResetStepError";
    this.step = step;
    this.rowsDeleted = rowsDeleted;
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** The demo owner's context. Module-private: never reaches the @cds/db root barrel. */
function demoOwnerContext(org: DemoOrg): OrgContext {
  return mintOrgContext({
    orgId: org.orgId,
    actor: org.ownerId,
    role: "owner",
    grants: [],
    ip: "demo-reset",
  });
}

/** Defence in depth: the org about to be wiped is re-read and must carry demo = true. */
async function assertDemoOrg(orgId: string): Promise<void> {
  const row = await withSuperuser((pb) =>
    pb.collection("organizations").getOne(orgId, { fields: "id,demo" }),
  );
  if (row.demo !== true) throw new InvalidInput("not the demo org");
}

/** The wiped collections, children first: reverse registry order (core, then add-ons). */
function wipeOrder(): string[] {
  const core = Object.keys(TENANT_COLLECTIONS);
  const addons = Object.keys(allTenantCollections()).filter(
    (n) => !core.includes(n),
  );
  return [...core, ...addons].reverse().filter((n) => !KEPT.has(n));
}

/** The org-bound filter for one collection (memberships keep the owner's row). */
function orgFilter(
  name: string,
  org: DemoOrg,
): { filter: string; params: Record<string, string> } {
  if (name === "memberships") {
    return {
      filter: "organization = {:org} && user != {:owner}",
      params: { org: org.orgId, owner: org.ownerId },
    };
  }
  return { filter: "organization = {:org}", params: { org: org.orgId } };
}

async function listIds(
  name: string,
  filter: string,
  params: Record<string, string>,
): Promise<RecordModel[]> {
  return withSuperuser(async (pb) => {
    const out: RecordModel[] = [];
    for (let page = 1; ; page++) {
      const res = await pb.collection(name).getList(page, PAGE, {
        filter: pb.filter(filter, params),
        sort: "id",
        fields: "id",
      });
      out.push(...res.items);
      if (page >= res.totalPages || res.items.length === 0) return out;
    }
  });
}

/** Rows the wipe would delete (dry run) or the seed wrote (after a reset). */
async function countDemoRows(org: DemoOrg): Promise<number> {
  assertAddonCollectionsRegistered();
  let total = 0;
  for (const name of wipeOrder()) {
    const { filter, params } = orgFilter(name, org);
    total += await withSuperuser(
      async (pb) =>
        (
          await pb.collection(name).getList(1, 1, {
            filter: pb.filter(filter, params),
            fields: "id",
          })
        ).totalItems,
    );
  }
  return total;
}

/** Delete the demo org's tenant rows and objects. Returns the rows deleted. Module-private. */
async function wipeDemoOrg(
  org: DemoOrg,
  deps: { store?: ObjectStore; publicStore?: ObjectStore } = {},
): Promise<number> {
  assertAddonCollectionsRegistered();
  await assertDemoOrg(org.orgId);
  let total = 0;
  let pending = wipeOrder();
  for (let pass = 0; pass < 2 && pending.length > 0; pass++) {
    const failed: string[] = [];
    for (const name of pending) {
      try {
        const { filter, params } = orgFilter(name, org);
        const rows = await listIds(name, filter, params);
        await withSuperuser(async (pb) => {
          for (const row of rows) {
            await pb.collection(name).delete(row.id);
            total += 1;
          }
        });
      } catch (err) {
        failed.push(name);
        if (pass === 1) {
          console.error(`[demo] wipe ${name} failed: ${errName(err)}`);
        }
      }
    }
    pending = failed;
  }
  if (pending.length > 0) {
    throw new Error(`demo rows left in ${pending.join(", ")}`);
  }

  const root = `${envPrefix()}tenants/${org.orgId}/`;
  const store = deps.store ?? getObjectStore();
  for (const o of await store.list(root)) {
    const rest = o.key.slice(root.length);
    if (KEPT_PREFIXES.some((p) => rest.startsWith(p))) continue;
    await store.delete(o.key);
  }
  const pub = deps.publicStore ?? getPublicMediaStore();
  for (const o of await pub.list(`${root}media/`)) await pub.delete(o.key);
  return total;
}

/**
 * What a reset would delete now (the job's dry run): the demo org's wipeable rows, or 0 when the
 * demo org does not exist yet. Reads only.
 */
export async function demoResetPreview(): Promise<{
  exists: boolean;
  rowsToDelete: number;
}> {
  const orgId = await findDemoOrgId();
  if (orgId === null) return { exists: false, rowsToDelete: 0 };
  const owner = await withSuperuser((pb) =>
    pb.collection("memberships").getList(1, 1, {
      filter: pb.filter("organization = {:org} && role = 'owner'", {
        org: orgId,
      }),
      sort: "created",
      fields: "user",
    }),
  );
  const ownerId = String(owner.items[0]?.user ?? "");
  return {
    exists: true,
    rowsToDelete: await countDemoRows({ orgId, ownerId, created: false }),
  };
}

/**
 * Ensure the demo org, wipe it, seed it again. `actor` names who reset it in the `demo.reset`
 * audit row (the job's system context, or the staff member).
 */
export async function resetDemoOrg(
  actor: SystemContext | PlatformContext,
  opts: DemoResetOptions,
): Promise<DemoResetResult> {
  // WR-A07: a staff actor needs the demo_reset role here too, not only in staffResetDemo.
  if (isPlatformContext(actor)) authorizeStaff(actor.staffRole, "demo_reset");
  else assertSystemContext(actor);
  const now = opts.now ?? new Date();
  const sys = mintSystemContext({ job: "demo-reset" });
  let org: DemoOrg;
  let rowsDeleted: number;
  try {
    org = await ensureDemoOrg(sys, { now });
    rowsDeleted = await wipeDemoOrg(org, opts);
  } catch (err) {
    throw new DemoResetStepError("wipe", 0, err);
  }
  try {
    await seedDemoContent(demoOwnerContext(org), { ...opts, now });
    const rowsSeeded = await countDemoRows(org);
    await withSuperuser(async (pb) => {
      await pb.collection("audit_log").create(
        auditBody(actor, {
          action: "demo.reset",
          organization: org.orgId,
          targetCollection: "organizations",
          targetId: org.orgId,
          meta: { rowsDeleted, rowsSeeded },
        }),
      );
    });
    await writePlatformMeta(sys, DEMO_LAST_RESET_KEY, now.toISOString());
    return { orgId: org.orgId, rowsDeleted, rowsSeeded };
  } catch (err) {
    throw new DemoResetStepError("seed", rowsDeleted, err);
  } finally {
    opts.invalidator?.invalidate([siteTag(org.orgId)]);
  }
}

/**
 * Staff "Reset now" (super_admin `demo_reset`; step-up is enforced by the console action).
 * Bypasses the 3 am hour, not the lock: a reset already running is refused.
 */
export async function staffResetDemo(
  ctx: PlatformContext,
  opts: DemoResetOptions,
): Promise<DemoResetResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "demo_reset");
  const now = opts.now ?? new Date();
  const token = await acquirePlatformLock(DEMO_LOCK_KEY, {
    now,
    staleMs: DEMO_LOCK_STALE_MS,
  });
  if (token === null) {
    throw new InvalidInput(
      "A demo reset is already running. Try again in a few minutes.",
    );
  }
  try {
    return await resetDemoOrg(ctx, { ...opts, now });
  } finally {
    await releasePlatformLock(DEMO_LOCK_KEY, token);
  }
}
