// TEN-08 / TEN-15 audited impersonation on the real PocketBase 0.39.11 binary (D10, D98,
// D287). Staff contexts come from a real password + OTP sign-in (plan 06 pattern): the OTP
// stand-in hook logs the code to the harness stdout.
import {
  Forbidden,
  ImpersonationDenied,
  InvalidContext,
  InvalidInput,
  NotFound,
} from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as db from "../src/index";
import { listAuditLog } from "../src/audit";
import { completeStaffSignIn, signInStaff } from "../src/auth";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import {
  endImpersonation,
  IMPERSONATION_SESSION_MS,
  resumeImpersonation,
  startImpersonation,
  startImpersonationSession,
} from "../src/impersonation";
import { requirePermission, tenantRepo } from "../src/repository";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const STAFF_IP = "203.0.113.7";
const DENY = [
  ["legal_ack", "run"],
  ["policy_accept", "run"],
  ["launch_approval", "run"],
  ["purchases", "run"],
  ["refunds", "run"],
  ["connect", "write"],
  ["dmca_counter", "run"],
  ["billing", "write"],
] as const;

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let superCtx: PlatformContext;
let agentCtx: PlatformContext;
let superId: string;
let imp: OrgContext; // admin view, super_admin, org A

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function otpCode(otpId: string): Promise<string> {
  const re = new RegExp(`OTP_STANDIN users (\\w+) ${otpId} (\\d{6})`);
  for (let i = 0; i < 100; i++) {
    const m = re.exec(inst!.stdout());
    if (m) return m[2]!;
    await sleep(50);
  }
  throw new Error(`no OTP_STANDIN line for ${otpId}`);
}

async function staff(
  email: string,
  role: "super_admin" | "support_agent",
): Promise<{ id: string; ctx: PlatformContext }> {
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const id = (
    await pb.collection("users").create({
      email,
      password,
      passwordConfirm: password,
      staff_role: role,
    })
  ).id;
  const started = await signInStaff(email, password, STAFF_IP);
  const code = await otpCode(started.otpId);
  const { ctx } = await completeStaffSignIn({
    mfaId: started.mfaId,
    otpId: started.otpId,
    code,
    ip: STAFF_IP,
  });
  return { id, ctx };
}

async function auditRows(filter: string, params: Record<string, unknown>) {
  return pb
    .collection("audit_log")
    .getFullList({ filter: pb.filter(filter, params) });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  const s = await staff("super-imp@cds.test", "super_admin");
  superId = s.id;
  superCtx = s.ctx;
  agentCtx = (await staff("agent-imp@cds.test", "support_agent")).ctx;
});

afterAll(async () => {
  await inst?.stop();
});

describe("TEN-08 startImpersonation", () => {
  it("returns an admin-view context and writes one impersonation.start row", async (t) => {
    if (!inst) return t.skip();
    imp = await startImpersonation(superCtx, seed.A.org, "support ticket 42");
    expect(imp.orgId).toBe(seed.A.org);
    expect(imp.actor).toBe(superId);
    expect(imp.impersonator).toBe(superId);
    expect(imp.role).toBe("admin");
    expect(imp.ip).toBe(STAFF_IP);
    const rows = await auditRows(
      "organization = {:o} && action = 'impersonation.start'",
      { o: seed.A.org },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meta).toEqual({
      reason: "support ticket 42",
      view: "admin",
    });
    expect(rows[0]!.ip).toBe(STAFF_IP);
    expect(rows[0]!.actor).toBe(superId);
    expect(rows[0]!.impersonator).toBe(superId);
  });

  it("rejects a bad reason and an unknown org", async (t) => {
    if (!inst) return t.skip();
    await expect(startImpersonation(superCtx, seed.A.org, "")).rejects.toThrow(
      InvalidInput,
    );
    await expect(
      startImpersonation(superCtx, seed.A.org, "x".repeat(501)),
    ).rejects.toThrow(InvalidInput);
    await expect(
      startImpersonation(superCtx, "zzzzzzzzzzzzzzz", "support ticket"),
    ).rejects.toThrow(NotFound);
  });

  it("rejects a forged or wrong-kind context (InvalidContext)", async (t) => {
    if (!inst) return t.skip();
    const forged = {
      actor: superId,
      staffRole: "super_admin",
      ip: STAFF_IP,
    } as unknown as PlatformContext;
    await expect(
      startImpersonation(forged, seed.A.org, "support ticket"),
    ).rejects.toThrow(InvalidContext);
    const orgCtxAsPlatform = seed.ctxA as unknown as PlatformContext;
    await expect(
      startImpersonation(orgCtxAsPlatform, seed.A.org, "support ticket"),
    ).rejects.toThrow(InvalidContext);
  });

  it("owner view is super_admin only", async (t) => {
    if (!inst) return t.skip();
    await expect(
      startImpersonation(agentCtx, seed.A.org, "needs owner view", {
        view: "owner",
      }),
    ).rejects.toThrow(Forbidden);
    const agentView = await startImpersonation(
      agentCtx,
      seed.A.org,
      "agent check",
    );
    expect(agentView.role).toBe("admin");
    const ownerView = await startImpersonation(
      superCtx,
      seed.A.org,
      "owner view check",
      { view: "owner" },
    );
    expect(ownerView.role).toBe("owner");
    await expect(
      startImpersonation(superCtx, seed.A.org, "bad view", {
        view: "god" as unknown as "owner",
      }),
    ).rejects.toThrow(InvalidInput);
  });
});

describe("TEN-08 writes under impersonation are audited", () => {
  it("create, update and delete each add one audit row with actor, impersonator, org and IP", async (t) => {
    if (!inst) return t.skip();
    const repo = tenantRepo("org_hosts");
    const rec = await repo.create(imp, {
      hostname: "support.example.com",
      kind: "custom",
    });
    expect((await pb.collection("org_hosts").getOne(rec.id)).organization).toBe(
      seed.A.org,
    );
    await repo.update(imp, rec.id, { primary: false });
    await repo.delete(imp, rec.id);
    for (const action of [
      "org_hosts.create",
      "org_hosts.update",
      "org_hosts.delete",
    ]) {
      const rows = await auditRows("target_id = {:id} && action = {:a}", {
        id: rec.id,
        a: action,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor).toBe(superId);
      expect(rows[0]!.impersonator).toBe(superId);
      expect(rows[0]!.organization).toBe(seed.A.org);
      expect(rows[0]!.ip).toBe(STAFF_IP);
    }
  });
});

describe("TEN-15 impersonation deny-list", () => {
  it("the default admin view still follows the role matrix (no billing)", async (t) => {
    if (!inst) return t.skip();
    expect(() => requirePermission(imp, "billing", "read")).toThrow(Forbidden);
    expect(() => requirePermission(imp, "settings", "write")).not.toThrow();
  });

  it("each deny-listed action throws ImpersonationDenied even in the owner view", async (t) => {
    if (!inst) return t.skip();
    const ownerView = await startImpersonation(
      superCtx,
      seed.A.org,
      "deny-list check",
      { view: "owner" },
    );
    for (const [feature, action] of DENY) {
      expect(() => requirePermission(ownerView, feature, action)).toThrow(
        ImpersonationDenied,
      );
      expect(() => requirePermission(seed.ctxA, feature, action)).not.toThrow();
    }
    await endImpersonation(ownerView);
  });
});

describe("TEN-15 tenant-visible audit log", () => {
  it("endImpersonation appends impersonation.end; a plain context is rejected", async (t) => {
    if (!inst) return t.skip();
    await endImpersonation(imp);
    const rows = await auditRows(
      "organization = {:o} && action = 'impersonation.end' && actor = {:a}",
      { o: seed.A.org, a: superId },
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.impersonator).toBe(superId);
    await expect(endImpersonation(seed.ctxA)).rejects.toThrow(InvalidInput);
  });

  it("the owner of A sees the impersonation start, end and write entries", async (t) => {
    if (!inst) return t.skip();
    const a = await listAuditLog(seed.ctxA, { perPage: 500 });
    const actions = a.items.map((r) => r.action);
    for (const want of [
      "impersonation.start",
      "impersonation.end",
      "org_hosts.create",
    ]) {
      expect(actions).toContain(want);
    }
    for (const r of a.items.filter((r) => r.action.startsWith("imperson"))) {
      expect(r.impersonator).not.toBe("");
      expect(r.organization).toBe(seed.A.org);
    }
  });

  it("the owner of B sees none of A's impersonation entries; an editor of A is Forbidden", async (t) => {
    if (!inst) return t.skip();
    const b = await listAuditLog(seed.ctxB, { perPage: 500 });
    expect(b.items.filter((r) => r.impersonator !== "")).toEqual([]);
    for (const r of b.items) expect(r.organization).toBe(seed.B.org);
    const editor = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "editor",
      grants: [],
      ip: "127.0.0.1",
    });
    await expect(listAuditLog(editor)).rejects.toThrow(Forbidden);
  });

  it("the public API exposes no way to change or delete audit rows", (t) => {
    if (!inst) return t.skip();
    const auditNames = Object.keys(db).filter((k) => /audit/i.test(k));
    // SENSITIVE_PRACTICE_AUDIT (11-24) is the action name string, not a writer;
    // staffListAuditLog (13-10) is the staff console's read of one site's log.
    expect(auditNames.sort()).toEqual(
      [
        "AUDIT_LOG_RETENTION_DAYS",
        // SENDING_LOCAL_PART_AUDIT (14-25) is the action name string, not a writer.
        "SENDING_LOCAL_PART_AUDIT",
        "SENSITIVE_PRACTICE_AUDIT",
        // STAFF_AUDIT_FILTERS (13-33) is the Audit tab's filter list, not a writer.
        "STAFF_AUDIT_FILTERS",
        "listAuditLog",
        "staffListAuditLog",
      ].sort(),
    );
    expect(typeof db.SENSITIVE_PRACTICE_AUDIT).toBe("string");
    expect(typeof db.SENDING_LOCAL_PART_AUDIT).toBe("string");
    expect(db.AUDIT_LOG_RETENTION_DAYS).toBe(730);
  });
});

describe("STAFF-06 impersonation session: start once, resume without writes, end (P13-P4)", () => {
  const startRows = (org: string) =>
    auditRows("organization = {:o} && action = 'impersonation.start'", {
      o: org,
    });

  it("start writes exactly one row and returns its id; five resumes write nothing", async (t) => {
    if (!inst) return t.skip();
    const before = (await startRows(seed.B.org)).length;
    const now = new Date();
    const s = await startImpersonationSession(
      superCtx,
      seed.B.org,
      "session check B",
      { now },
    );
    expect(s.ctx.impersonator).toBe(superId);
    expect(s.ctx.role).toBe("admin");
    expect(s.startedAt).toBe(now.toISOString());
    expect(Date.parse(s.expiresAt) - Date.parse(s.startedAt)).toBe(
      IMPERSONATION_SESSION_MS,
    );
    const row = await pb.collection("audit_log").getOne(s.startId);
    expect(row.action).toBe("impersonation.start");
    expect(row.organization).toBe(seed.B.org);
    const totalBefore = (await pb.collection("audit_log").getList(1, 1))
      .totalItems;
    for (let i = 0; i < 5; i++) {
      const r = await resumeImpersonation(superCtx, {
        orgId: seed.B.org,
        view: "admin",
        startId: s.startId,
      });
      const ctx = r.ctx;
      // 13-26 choice 4: the banner facts come back with the context.
      expect(r.business).not.toBe("");
      expect(r.reason.length).toBeGreaterThanOrEqual(3);
      expect(r.startId).toBe(s.startId);
      expect(Date.parse(r.expiresAt) - Date.parse(r.startedAt)).toBe(
        IMPERSONATION_SESSION_MS,
      );
      expect(ctx.impersonator).toBe(superId);
      expect(ctx.actor).toBe(superId);
      expect(ctx.role).toBe("admin");
      expect(ctx.orgId).toBe(seed.B.org);
    }
    expect((await pb.collection("audit_log").getList(1, 1)).totalItems).toBe(
      totalBefore,
    );
    expect((await startRows(seed.B.org)).length).toBe(before + 1);
  });

  it("resume refuses after 60 minutes, for another staff, another org or another view", async (t) => {
    if (!inst) return t.skip();
    const s = await startImpersonationSession(
      superCtx,
      seed.B.org,
      "expiry check",
    );
    const row = await pb.collection("audit_log").getOne(s.startId);
    const created = Date.parse(String(row.created).replace(" ", "T"));
    const ok = {
      orgId: seed.B.org,
      view: "admin" as const,
      startId: s.startId,
    };
    await expect(
      resumeImpersonation(superCtx, {
        ...ok,
        now: new Date(created + 59 * 60_000),
      }),
    ).resolves.toBeTruthy();
    await expect(
      resumeImpersonation(superCtx, {
        ...ok,
        now: new Date(created + 61 * 60_000),
      }),
    ).rejects.toThrow(Forbidden);
    await expect(resumeImpersonation(agentCtx, ok)).rejects.toThrow(Forbidden);
    await expect(
      resumeImpersonation(superCtx, { ...ok, orgId: seed.A.org }),
    ).rejects.toThrow(Forbidden);
    await expect(
      resumeImpersonation(superCtx, { ...ok, view: "owner" }),
    ).rejects.toThrow(Forbidden);
    await expect(
      resumeImpersonation(superCtx, { ...ok, startId: "../x" }),
    ).rejects.toThrow(Forbidden);
    await expect(
      resumeImpersonation(superCtx, { ...ok, startId: "zzzzzzzzzzzzzzz" }),
    ).rejects.toThrow(Forbidden);
  });

  it("support_agent may not take the owner view; a 2-character reason is InvalidInput", async (t) => {
    if (!inst) return t.skip();
    await expect(
      startImpersonationSession(agentCtx, seed.B.org, "owner please", {
        view: "owner",
      }),
    ).rejects.toThrow(Forbidden);
    await expect(
      startImpersonationSession(superCtx, seed.B.org, "ok"),
    ).rejects.toThrow(InvalidInput);
  });

  it("a write under the resumed context is audited with the impersonator; support:write is refused", async (t) => {
    if (!inst) return t.skip();
    const s = await startImpersonationSession(
      superCtx,
      seed.B.org,
      "write check",
    );
    const { ctx } = await resumeImpersonation(superCtx, {
      orgId: seed.B.org,
      view: "admin",
      startId: s.startId,
    });
    const repo = tenantRepo("org_hosts");
    const rec = await repo.create(ctx, {
      hostname: "resume.example.com",
      kind: "custom",
    });
    const rows = await auditRows("target_id = {:id} && action = {:a}", {
      id: rec.id,
      a: "org_hosts.create",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.impersonator).toBe(superId);
    expect(rows[0]!.organization).toBe(seed.B.org);
    await repo.delete(ctx, rec.id);
    expect(() => requirePermission(ctx, "support", "write")).toThrow(
      ImpersonationDenied,
    );
  });

  it("end writes impersonation.end with meta.startId; resume then refuses", async (t) => {
    if (!inst) return t.skip();
    const s = await startImpersonationSession(
      superCtx,
      seed.B.org,
      "end check",
    );
    const other = await startImpersonationSession(
      superCtx,
      seed.B.org,
      "parallel session",
    );
    await endImpersonation(s.ctx, { startId: s.startId });
    const rows = await auditRows(
      "organization = {:o} && action = 'impersonation.end' && meta.startId = {:sid}",
      { o: seed.B.org, sid: s.startId },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meta).toEqual({ startId: s.startId });
    expect(rows[0]!.impersonator).toBe(superId);
    await expect(
      resumeImpersonation(superCtx, {
        orgId: seed.B.org,
        view: "admin",
        startId: s.startId,
      }),
    ).rejects.toThrow(Forbidden);
    // Ending one session leaves another running one alone.
    await expect(
      resumeImpersonation(superCtx, {
        orgId: seed.B.org,
        view: "admin",
        startId: other.startId,
      }),
    ).resolves.toBeTruthy();
    await expect(endImpersonation(s.ctx, { startId: "../x" })).rejects.toThrow(
      InvalidInput,
    );
  });
});
