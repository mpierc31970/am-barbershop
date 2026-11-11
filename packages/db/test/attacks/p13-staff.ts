// P13 staff console attacks (13-06, TEN-03, invariant 1, STAFF-14): failsafe_requests is the
// one P13 tenant collection. It is writes: custom, so the generic repo is read-only and org
// B's get of org A's row is NotFound. 13-18 adds the function-level keys
// (`failsafe_requests:<area>`): staff list, convert and dismiss scoped to org B against org
// A's row (NotFound; a member context is refused outright), and the tenant read
// listPendingRequests as org B returns none of org A's rows. The suite's "left every org A
// row unchanged" snapshot proves none of them wrote.
import { InvalidContext, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { expect } from "vitest";
import { FIXTURE_PREMIUM_OK } from "../../../core/src/addons/__fixtures__/manifests";
import { mintPlatformContext, type PlatformContext } from "../../src/context";
import {
  listPendingRequests,
  staffConvertFailsafeRequest,
  staffDismissFailsafeRequest,
  staffListFailsafeRequests,
} from "../../src/staff/failsafe";
import type { TwoOrgs } from "../fixtures";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

export const P13_STAFF_COLLECTIONS = ["failsafe_requests"] as const;

export type P13StaffCollection = (typeof P13_STAFF_COLLECTIONS)[number];

export type P13StaffSeed = {
  rows: Record<P13StaffCollection, { A: string; B: string }>;
};

async function seedFailsafe(
  pb: PocketBase,
  org: string,
  label: string,
): Promise<string> {
  const row = await pb.collection("failsafe_requests").create({
    organization: org,
    addon: "appointments",
    capture_id: `cap-${label}-${org}`,
    name: `Visitor ${label}`,
    email: `visitor-${label.toLowerCase()}@example.com`,
    phone: "555-0100",
    preferred: "Tuesday morning",
    message: `Fail-safe request ${label}`,
    captured_at: new Date().toISOString(),
    status: "pending",
  });
  return row.id;
}

/** One failsafe_requests row per org (superuser inserts). */
export async function seedP13Staff(
  pb: PocketBase,
  seed: TwoOrgs,
): Promise<P13StaffSeed> {
  return {
    rows: {
      failsafe_requests: {
        A: await seedFailsafe(pb, seed.A.org, "A"),
        B: await seedFailsafe(pb, seed.B.org, "B"),
      },
    },
  };
}

function staff(): PlatformContext {
  return mintPlatformContext({
    actor: "attackstaff0001",
    staffRole: "super_admin",
    ip: "203.0.113.66",
  });
}

function rowA(env: AttackEnv): string {
  return env.seedRecordFor("failsafe_requests").a;
}

/** Staff scoped to org B cannot list org A's row; a member context is refused. */
function listAttack(env: AttackEnv): () => Promise<void> {
  return async () => {
    const { B, ctxB } = env.seed();
    const rows = await staffListFailsafeRequests(staff(), {
      orgId: B.org,
      status: "all",
    });
    expect(rows.map((r) => r.id)).not.toContain(rowA(env));
    await expect(
      staffListFailsafeRequests(ctxB as unknown as PlatformContext),
    ).rejects.toThrow(InvalidContext);
    const pending = await listPendingRequests(ctxB, "appointments");
    expect(pending.map((r) => r.id)).not.toContain(rowA(env));
  };
}

function convertAttack(env: AttackEnv): () => Promise<void> {
  return async () => {
    const { B, ctxB } = env.seed();
    await expect(
      staffConvertFailsafeRequest(staff(), rowA(env), {
        manifests: [FIXTURE_PREMIUM_OK],
        orgId: B.org,
      }),
    ).rejects.toThrow(NotFound);
    await expect(
      staffConvertFailsafeRequest(
        ctxB as unknown as PlatformContext,
        rowA(env),
        { manifests: [FIXTURE_PREMIUM_OK] },
      ),
    ).rejects.toThrow(InvalidContext);
  };
}

function dismissAttack(env: AttackEnv): () => Promise<void> {
  return async () => {
    const { B, ctxB } = env.seed();
    await expect(
      staffDismissFailsafeRequest(staff(), rowA(env), "spam", {
        orgId: B.org,
      }),
    ).rejects.toThrow(NotFound);
    await expect(
      staffDismissFailsafeRequest(
        ctxB as unknown as PlatformContext,
        rowA(env),
        "spam",
      ),
    ).rejects.toThrow(InvalidContext);
  };
}

export function attacks(env: AttackEnv): AttackMap {
  return {
    failsafe_requests: readOnlyAttack(env, "failsafe_requests"),
    // 13-18 function-level attacks.
    "failsafe_requests:list": listAttack(env),
    "failsafe_requests:convert": convertAttack(env),
    "failsafe_requests:dismiss": dismissAttack(env),
  };
}
