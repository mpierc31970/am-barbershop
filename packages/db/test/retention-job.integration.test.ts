// 09-12: org closure and the retention job on the real PocketBase 0.39.11 binary (LIFE-02,
// AGR-05, D283, D290, invariant 9; CONTEXT A4-Q1..Q4; RESEARCH Pattern 8, Pitfalls 4-6).
// Destructive path: every case carries a lapsed control (disabled, no closed_reason) and a
// live control, and asserts both survive.
import "@cds/addon-registry/server";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidContext, InvalidInput } from "@cds/core";
import {
  AGREEMENT_RETENTION_YEARS,
  AUDIT_LOG_RETENTION_DAYS as CORE_AUDIT_DAYS,
  EXPORT_RETENTION_DAYS as CORE_EXPORT_DAYS,
  LEGAL_EVIDENCE_AUDIT_ACTIONS,
} from "@cds/core/legal";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as db from "../src/index";
import { superuser } from "../src/client";
import { mintSystemContext, type PlatformContext } from "../src/context";
import {
  runRetentionJob,
  RETENTION_COUNTS_KEY,
  RETENTION_HEARTBEAT_KEY,
  retentionStatus,
  type RetentionJobDeps,
} from "../src/jobs/retention";
import { markOrgClosed, reopenOrg } from "../src/org-closure";
import { readPlatformMeta, writePlatformMeta } from "../src/platform-meta";
import { allTenantCollections } from "../src/registry";
import { envPrefix, tenantAgreementKey, tenantExportKey } from "../src/storage";
import type { ObjectStore } from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { bootSeededPb, orgRowIds, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let staff: PlatformContext;
const DAY = 24 * 3_600_000;

async function orgRow(id: string) {
  const pb = await superuser();
  return pb.collection("organizations").getOne(id);
}

let orgSeq = 0;
async function makeOrg(fields: Record<string, unknown> = {}): Promise<string> {
  const pb = await superuser();
  orgSeq += 1;
  const r = await pb.collection("organizations").create({
    name: `Closure ${orgSeq}`,
    slug: `closure-${Date.now().toString(36)}-${orgSeq}`,
    status: "active",
    ...fields,
  });
  return r.id;
}

async function auditRows(action: string, orgId: string) {
  const pb = await superuser();
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("action = {:action} && target_id = {:id}", {
      action,
      id: orgId,
    }),
  });
}

describe("retention constants (CONTEXT A4-Q1)", () => {
  it("@cds/db re-exports the one retention table's numbers", () => {
    expect(db.AUDIT_LOG_RETENTION_DAYS).toBe(730);
    expect(db.AUDIT_LOG_RETENTION_DAYS).toBe(CORE_AUDIT_DAYS);
    expect(db.EXPORT_RETENTION_DAYS).toBe(90);
    expect(db.EXPORT_RETENTION_DAYS).toBe(CORE_EXPORT_DAYS);
  });
});

describe("markOrgClosed / reopenOrg (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
    if (booted) {
      staff = await staffContext(
        booted.inst,
        "closure-staff@cds.test",
        "super_admin",
      );
    }
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });

  it("closes an org: reason, closed_at, disabled, one audit row", async (ctx) => {
    if (!booted) return ctx.skip();
    const org = await makeOrg();
    const now = new Date("2026-10-08T12:00:00.000Z");
    const { closedAt } = await markOrgClosed(staff, org, "cancelled", { now });
    expect(closedAt).toBe(now.toISOString());
    const row = await orgRow(org);
    expect(row.closed_reason).toBe("cancelled");
    expect(
      new Date(String(row.closed_at).replace(" ", "T")).toISOString(),
    ).toBe(now.toISOString());
    expect(row.status).toBe("disabled");
    const audits = await auditRows("organization.close", org);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.organization).toBe(org);
    expect(audits[0]!.meta).toMatchObject({ reason: "cancelled" });
  });

  it("a system context may close an org", async (ctx) => {
    if (!booted) return ctx.skip();
    const org = await makeOrg();
    await markOrgClosed(mintSystemContext({ job: "test" }), org, "declined");
    expect((await orgRow(org)).closed_reason).toBe("declined");
  });

  it("refuses an org context (even the owner) before any write", async (ctx) => {
    if (!booted) return ctx.skip();
    const { seed } = booted;
    await expect(
      markOrgClosed(
        seed.ctxA as unknown as PlatformContext,
        seed.A.org,
        "cancelled",
      ),
    ).rejects.toBeInstanceOf(InvalidContext);
    const row = await orgRow(seed.A.org);
    expect(row.closed_reason).toBe("");
    expect(row.status).toBe("active");
    expect(await auditRows("organization.close", seed.A.org)).toHaveLength(0);
  });

  it("refuses an unknown reason; a lapse is never a closed reason", async (ctx) => {
    if (!booted) return ctx.skip();
    const org = await makeOrg();
    await expect(
      markOrgClosed(staff, org, "lapsed" as never),
    ).rejects.toBeInstanceOf(InvalidInput);
    expect((await orgRow(org)).closed_reason).toBe("");
  });

  it("reopens within 30 days: fields cleared, active, audited", async (ctx) => {
    if (!booted) return ctx.skip();
    const org = await makeOrg();
    const closed = new Date(Date.now() - 10 * DAY);
    await markOrgClosed(staff, org, "taken_down", { now: closed });
    await reopenOrg(staff, org);
    const row = await orgRow(org);
    expect(row.closed_reason).toBe("");
    expect(row.closed_at).toBe("");
    expect(row.status).toBe("active");
    expect(await auditRows("organization.reopen", org)).toHaveLength(1);
  });

  it("reopen restores the pre-closure status, never forcing active (WR-A02)", async (ctx) => {
    if (!booted) return ctx.skip();
    const closed = new Date(Date.now() - 5 * DAY);
    // A held site (awaiting fit review), closed twice: reopening returns it to held.
    const held = await makeOrg({ status: "held" });
    await markOrgClosed(staff, held, "declined", { now: closed });
    expect((await orgRow(held)).closed_prev_status).toBe("held");
    await markOrgClosed(staff, held, "taken_down", { now: closed });
    expect((await orgRow(held)).closed_prev_status).toBe("held");
    await reopenOrg(staff, held);
    let row = await orgRow(held);
    expect(row.status).toBe("held");
    expect(row.closed_prev_status).toBe("");
    // A lapsed (disabled) site stays disabled after a reopen (invariant 9).
    const lapsed = await makeOrg({ status: "disabled" });
    await markOrgClosed(staff, lapsed, "cancelled", { now: closed });
    await reopenOrg(staff, lapsed);
    expect((await orgRow(lapsed)).status).toBe("disabled");
    // Unknown prior status (closed before the field existed): held, never active.
    const legacy = await makeOrg({
      status: "disabled",
      closed_reason: "cancelled",
      closed_at: closed.toISOString(),
    });
    await reopenOrg(staff, legacy);
    row = await orgRow(legacy);
    expect(row.status).toBe("held");
    const audits = await auditRows("organization.reopen", legacy);
    expect(audits[0]!.meta).toMatchObject({ status: "held" });
  });

  it("refuses to reopen after 30 days, or an org that is not closed", async (ctx) => {
    if (!booted) return ctx.skip();
    const org = await makeOrg();
    await markOrgClosed(staff, org, "cancelled", {
      now: new Date(Date.now() - 31 * DAY),
    });
    await expect(reopenOrg(staff, org)).rejects.toBeInstanceOf(InvalidInput);
    expect((await orgRow(org)).closed_reason).toBe("cancelled");
    const open = await makeOrg();
    await expect(reopenOrg(staff, open)).rejects.toBeInstanceOf(InvalidInput);
  });
});

// ------------------------------------------------------------------ runRetentionJob

const SHA = "a".repeat(64);

function randomId(): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(randomBytes(15), (b) => abc[b % abc.length]).join("");
}

async function seedSignature(org: string, retainUntil: Date): Promise<string> {
  const pb = await superuser();
  const id = randomId();
  await pb.collection("agreement_signatures").create({
    id,
    organization: org,
    signer: randomId(),
    signer_email: `signer-${id}@cds.test`,
    signer_name: "Sam Signer",
    org_name: "Org",
    policies: [{ key: "terms-of-service", version: 1, sha256: SHA }],
    consent: { version: 1, sha256: SHA },
    ip: "203.0.113.9",
    user_agent: "test",
    auth_method: "password",
    signed_at: new Date(retainUntil.getTime() - 7 * 365 * DAY).toISOString(),
    document_key: tenantAgreementKey(org, id, "html"),
    document_sha256: SHA,
    evidence_sha256: SHA,
    retain_until: retainUntil.toISOString(),
    kind: "signup",
  });
  return id;
}

async function seedAck(org: string, retainUntil: Date): Promise<string> {
  const pb = await superuser();
  const r = await pb.collection("site_policy_acks").create({
    organization: org,
    user: randomId(),
    user_name: "Owner",
    kind: "ack",
    template_version: 1,
    privacy_sha256: SHA,
    terms_sha256: SHA,
    clause_ids: ["core"],
    ip: "203.0.113.9",
    acked_at: new Date(retainUntil.getTime() - 7 * 365 * DAY).toISOString(),
    retain_until: retainUntil.toISOString(),
  });
  return r.id;
}

async function exists(collection: string, id: string): Promise<boolean> {
  const pb = await superuser();
  try {
    await pb.collection(collection).getOne(id);
    return true;
  } catch {
    return false;
  }
}

async function closedOrg(daysAgo: number, now: Date): Promise<string> {
  return makeOrg({
    status: "disabled",
    closed_reason: "cancelled",
    closed_at: new Date(now.getTime() - daysAgo * DAY).toISOString(),
  });
}

async function has(store: ObjectStore, key: string): Promise<boolean> {
  return (await store.get(key)) !== null;
}

describe("runRetentionJob (throwaway PocketBase)", () => {
  let job: SeededPb | null = null;
  let dir = "";
  let priv: LocalDiskStore;
  let pub: LocalDiskStore;
  const T = new Date();
  const T_BOOT = new Date(T.getTime() - 60_000);
  const deps = (): RetentionJobDeps => ({
    privateStore: priv,
    publicStore: pub,
    agreementStore: priv,
  });

  // Fixture ids, filled in beforeAll.
  let C = ""; // closed 31 days ago (the seed's org A: rows in every registry collection)
  let K = ""; // closed 29 days ago
  let L = ""; // lapsed: disabled, no reason
  let Z = ""; // live (the seed's org B)
  const D = randomId(); // deleted earlier: no organizations row
  let staffUser = "";
  let users: string[] = [];
  let keptSig = "";
  let expiredSig = "";
  let expiredAck = "";
  let keys: Record<string, string> = {};
  let ideaC = ""; // suggested by C, voted by C and Z
  let ideaZ = ""; // suggested by Z, voted by C and Z
  const storeOf = (name: string) => (name.endsWith("Media") ? pub : priv);

  beforeAll(async () => {
    job = await bootSeededPb();
    if (!job) return;
    dir = await mkdtemp(join(tmpdir(), "cds-retention-"));
    priv = new LocalDiskStore(join(dir, "private"));
    pub = new LocalDiskStore(join(dir, "public"));
    const pb = await superuser();
    const { seed } = job;
    C = seed.A.org;
    Z = seed.B.org;
    users = [seed.A.owner, seed.renterA, seed.renterA2];
    await pb.collection("organizations").update(C, {
      status: "disabled",
      closed_reason: "cancelled",
      closed_at: new Date(T.getTime() - 31 * DAY).toISOString(),
    });
    K = await closedOrg(29, T);
    L = await makeOrg({ status: "disabled" });
    const pw = randomBytes(16).toString("hex");
    staffUser = (
      await pb.collection("users").create({
        email: "retention-staff@cds.test",
        password: pw,
        passwordConfirm: pw,
        staff_role: "support_agent",
      })
    ).id;
    await pb
      .collection("memberships")
      .create({ user: staffUser, organization: C, role: "admin" });

    // 12-REVIEW WR-A07: feature ideas are platform rows; the deleted site's votes and text go.
    const idea = async (source: string) =>
      (
        await pb.collection("feature_ideas").create({
          title: `Idea from ${source}`,
          description: "Gift cards.",
          status: "suggested",
          votes: 2,
          source_org: source,
          source_thread: randomId(),
        })
      ).id;
    ideaC = await idea(C);
    ideaZ = await idea(Z);
    for (const i of [ideaC, ideaZ]) {
      for (const o of [C, Z]) {
        await pb
          .collection("feature_idea_votes")
          .create({ organization: o, idea: i });
      }
    }

    keptSig = await seedSignature(C, new Date(T.getTime() + 7 * 365 * DAY));
    expiredSig = await seedSignature(Z, new Date(T.getTime() - DAY));
    expiredAck = await seedAck(Z, new Date(T.getTime() - DAY));

    const root = (org: string) => `${envPrefix()}tenants/${org}/`;
    keys = {
      cPublished: `${root(C)}published/pages/p1.json`,
      cVersion: `${root(C)}versions/pages/p1/v1.json`,
      cAgreementJson: tenantAgreementKey(C, keptSig, "json"),
      cAgreementHtml: tenantAgreementKey(C, keptSig, "html"),
      cExportOld: tenantExportKey(C, new Date(T.getTime() - 100 * DAY)),
      cExportNew: tenantExportKey(C, new Date(T.getTime() - 10 * DAY)),
      cMedia: `${root(C)}media/image/asset1/thumb.webp`,
      kPublished: `${root(K)}published/pages/p1.json`,
      kMedia: `${root(K)}media/image/asset1/thumb.webp`,
      zPublished: `${root(Z)}published/pages/p1.json`,
      expJson: tenantAgreementKey(Z, expiredSig, "json"),
      expHtml: tenantAgreementKey(Z, expiredSig, "html"),
      dExportOld: tenantExportKey(D, new Date(T.getTime() - 100 * DAY)),
      dExportNew: tenantExportKey(D, new Date(T.getTime() - 10 * DAY)),
    };
    for (const [name, key] of Object.entries(keys)) {
      await storeOf(name).put(key, "{}");
    }
  });

  afterAll(async () => {
    await job?.inst.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("dry run reports would-delete counts and changes nothing", async (ctx) => {
    if (!job) return ctx.skip();
    const r = await runRetentionJob({ now: T, dryRun: true, deps: deps() });
    expect(r).toMatchObject({
      dryRun: true,
      orgsDue: 1,
      orgsDeleted: 0,
      capHit: false,
      signaturesExpired: 1,
      acksExpired: 1,
      auditDeleted: 0,
      orphanExportsPruned: 1,
      usersDeleted: 3,
      keptAgreementsForDeletedOrgs: 1,
      failedSteps: [],
    });
    expect(r.deletedOrgs.map((o) => o.id)).toEqual([C]);
    expect(await exists("organizations", C)).toBe(true);
    expect(await exists("agreement_signatures", expiredSig)).toBe(true);
    expect(await exists("site_policy_acks", expiredAck)).toBe(true);
    for (const u of users) expect(await exists("users", u)).toBe(true);
    for (const [name, key] of Object.entries(keys)) {
      expect(await has(storeOf(name), key), name).toBe(true);
    }
    expect(await readPlatformMeta(RETENTION_HEARTBEAT_KEY)).toBeNull();
    expect(await readPlatformMeta(RETENTION_COUNTS_KEY)).toBeNull();
    expect(await auditRows("organization.delete", C)).toHaveLength(0);
  });

  it("deletes the closed org and expired evidence; keeps lapsed, live and signatures", async (ctx) => {
    if (!job) return ctx.skip();
    const r = await runRetentionJob({ now: T, deps: deps() });
    expect(r).toMatchObject({
      dryRun: false,
      orgsDue: 1,
      orgsDeleted: 1,
      capHit: false,
      signaturesExpired: 1,
      acksExpired: 1,
      orphanExportsPruned: 1,
      usersDeleted: 3,
      keptAgreementsForDeletedOrgs: 1,
      failedSteps: [],
    });
    expect(r.deletedOrgs).toEqual([
      expect.objectContaining({ id: C, reason: "cancelled" }),
    ]);

    // The closed org and everything it owned.
    expect(await exists("organizations", C)).toBe(false);
    for (const name of Object.keys(allTenantCollections())) {
      if (
        ["audit_log", "agreement_signatures", "site_policy_acks"].includes(name)
      ) {
        continue;
      }
      expect(await orgRowIds(name, C), name).toEqual([]);
    }
    for (const u of users) expect(await exists("users", u)).toBe(false);
    expect(await exists("users", staffUser)).toBe(true);
    expect(await has(priv, keys.cPublished!)).toBe(false);
    expect(await has(priv, keys.cVersion!)).toBe(false);
    expect(await has(pub, keys.cMedia!)).toBe(false);
    // Evidence and exports outlive the org.
    expect(await exists("agreement_signatures", keptSig)).toBe(true);
    expect(await has(priv, keys.cAgreementJson!)).toBe(true);
    expect(await has(priv, keys.cAgreementHtml!)).toBe(true);
    expect(await has(priv, keys.cExportOld!)).toBe(true);
    expect(await has(priv, keys.cExportNew!)).toBe(true);

    // 12-REVIEW WR-A07: votes recounted; C's own idea hidden and unlinked; Z's stays listed.
    const pbx = await superuser();
    const ic = await pbx.collection("feature_ideas").getOne(ideaC);
    expect(ic).toMatchObject({
      votes: 1,
      source_org: "",
      source_thread: "",
      hold_reason: "source_deleted",
    });
    expect(ic.hidden_at).not.toBe("");
    const iz = await pbx.collection("feature_ideas").getOne(ideaZ);
    expect(iz).toMatchObject({ votes: 1, source_org: Z, hidden_at: "" });

    // Controls: closed 29 days, lapsed, live.
    for (const id of [K, L, Z]) {
      expect(await exists("organizations", id)).toBe(true);
    }
    expect((await orgRow(L)).status).toBe("disabled");
    expect(await orgRowIds("memberships", Z)).not.toEqual([]);
    expect(await has(priv, keys.kPublished!)).toBe(true);
    expect(await has(pub, keys.kMedia!)).toBe(true);
    expect(await has(priv, keys.zPublished!)).toBe(true);

    // Expired evidence: objects and rows gone.
    expect(await exists("agreement_signatures", expiredSig)).toBe(false);
    expect(await has(priv, keys.expJson!)).toBe(false);
    expect(await has(priv, keys.expHtml!)).toBe(false);
    expect(await exists("site_policy_acks", expiredAck)).toBe(false);

    // Orphan exports of a long-deleted org age out.
    expect(await has(priv, keys.dExportOld!)).toBe(false);
    expect(await has(priv, keys.dExportNew!)).toBe(true);

    // Attributable summary row, heartbeat and counts (ids and names never in counts).
    const summary = await auditRows("organization.delete", C);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.target_collection).toBe("organizations");
    expect(summary[0]!.meta).toMatchObject({ closed_reason: "cancelled" });
    expect(await readPlatformMeta(RETENTION_HEARTBEAT_KEY)).toBe(
      T.toISOString(),
    );
    const raw = (await readPlatformMeta(RETENTION_COUNTS_KEY)) ?? "{}";
    expect(JSON.parse(raw)).toMatchObject({ orgsDeleted: 1, failedSteps: [] });
    expect(raw).not.toContain(C);
    expect(raw).not.toContain("Org A");
  });

  it("deletes at most RETENTION_ORG_CAP_PER_RUN orgs per run, oldest first", async (ctx) => {
    if (!job) return ctx.skip();
    const due: string[] = [];
    for (let i = 0; i < 7; i++) due.push(await closedOrg(40 + i, T));
    const r = await runRetentionJob({ now: T, deps: deps() });
    expect(r).toMatchObject({
      orgsDue: 7,
      orgsDeleted: 5,
      capHit: true,
      failedSteps: [],
    });
    const alive = await Promise.all(
      due.map((id) => exists("organizations", id)),
    );
    // closed 40 and 41 days ago are the two newest, so they wait for the next run.
    expect(alive).toEqual([true, true, false, false, false, false, false]);
    const next = await runRetentionJob({ now: T, deps: deps() });
    expect(next).toMatchObject({ orgsDue: 2, orgsDeleted: 2, capHit: false });
    expect(await exists("organizations", K)).toBe(true);
  });

  it("re-checks each org before deleting it (reopened in between: skipped)", async (ctx) => {
    if (!job) return ctx.skip();
    const org = await closedOrg(45, T);
    const r = await runRetentionJob({
      now: T,
      deps: {
        ...deps(),
        beforeOrgDelete: async (id) => {
          const pb = await superuser();
          await pb.collection("organizations").update(id, {
            closed_reason: "",
            closed_at: "",
            status: "active",
          });
        },
      },
    });
    expect(r.orgsDue).toBe(1);
    expect(r.orgsDeleted).toBe(0);
    expect(await exists("organizations", org)).toBe(true);
  });

  it("a failing step is reported, later steps still run, and no heartbeat is written", async (ctx) => {
    if (!job) return ctx.skip();
    const org = await closedOrg(50, T);
    const ack = await seedAck(Z, new Date(T.getTime() - DAY));
    const later = new Date(T.getTime() + 60_000);
    const down = () => Promise.reject(new Error("public store down"));
    const broken: ObjectStore = {
      put: down,
      get: down,
      list: down,
      delete: down,
    };
    const r = await runRetentionJob({
      now: later,
      deps: { ...deps(), publicStore: broken },
    });
    expect(r.failedSteps).toEqual(["closed-orgs"]);
    expect(r.orgsDeleted).toBe(0);
    expect(await exists("organizations", org)).toBe(true);
    expect(r.acksExpired).toBe(1);
    expect(await exists("site_policy_acks", ack)).toBe(false);
    // The heartbeat still holds the earlier run's time; the counts show the failure.
    expect(await readPlatformMeta(RETENTION_HEARTBEAT_KEY)).toBe(
      T.toISOString(),
    );
    const counts = JSON.parse(
      (await readPlatformMeta(RETENTION_COUNTS_KEY)) ?? "{}",
    );
    expect(counts.failedSteps).toEqual(["closed-orgs"]);
  });

  it("deletes audit rows only once they are older than 730 days", async (ctx) => {
    if (!job) return ctx.skip();
    // `created` is an autodate PocketBase sets on insert and never lets a client write, so
    // the 729/731-day boundary is proven by moving `now` instead of backdating rows.
    const pb = await superuser();
    const row = (
      await pb.collection("audit_log").create({
        organization: Z,
        action: "test.marker",
      })
    ).id;
    // Legal evidence rows follow the 7-year signature clock, not the 2-year one (CR-A02).
    const legal: Record<string, string> = {};
    for (const action of LEGAL_EVIDENCE_AUDIT_ACTIONS) {
      legal[action] = (
        await pb.collection("audit_log").create({
          organization: Z,
          action,
          target_collection: "agreement_signatures",
          target_id: randomId(),
        })
      ).id;
    }
    const T_AFTER = new Date();
    const keep = await runRetentionJob({
      now: new Date(T_BOOT.getTime() + 729 * DAY),
      dryRun: true,
      deps: deps(),
    });
    expect(keep.auditDeleted).toBe(0);
    const gone = await runRetentionJob({
      now: new Date(T_AFTER.getTime() + 731 * DAY),
      deps: deps(),
    });
    expect(gone.auditDeleted).toBeGreaterThan(0);
    expect(await exists("audit_log", row)).toBe(false);
    for (const [action, id] of Object.entries(legal)) {
      expect(await exists("audit_log", id), action).toBe(true);
    }
    // Lapsed and live orgs survive even a run two years on (invariant 9).
    for (const id of [L, Z]) {
      expect(await exists("organizations", id)).toBe(true);
    }
    // Just short of 7 UTC years the evidence rows stay; past it they go.
    const sevenYears = (d: Date, days: number) => {
      const out = new Date(d.getTime() + days * DAY);
      out.setUTCFullYear(out.getUTCFullYear() + AGREEMENT_RETENTION_YEARS);
      return out;
    };
    await runRetentionJob({ now: sevenYears(T_BOOT, -1), deps: deps() });
    for (const [action, id] of Object.entries(legal)) {
      expect(await exists("audit_log", id), action).toBe(true);
    }
    await runRetentionJob({ now: sevenYears(T_AFTER, 1), deps: deps() });
    for (const [action, id] of Object.entries(legal)) {
      expect(await exists("audit_log", id), action).toBe(false);
    }
  });
});

describe("retentionStatus (09-21)", () => {
  let st: SeededPb | null = null;
  const NOW = new Date("2026-10-08T12:00:00.000Z");

  beforeAll(async () => {
    st = await bootSeededPb();
  });
  afterAll(async () => {
    await st?.inst.stop();
  });

  it("reads no heartbeat as null and counts only closed orgs past 30 days", async (ctx) => {
    if (!st) return ctx.skip();
    expect(await retentionStatus(NOW)).toEqual({
      last_success: null,
      cap_hit: false,
      overdue_closed_orgs: 0,
    });

    await closedOrg(31, NOW); // overdue
    await closedOrg(29, NOW); // still inside the 30 days
    await makeOrg({ status: "disabled" }); // lapsed: never counted (invariant 9)
    // Closed, then re-enabled by a status edit: the job skips it, so it is not overdue (WR-A01).
    await makeOrg({
      status: "active",
      closed_reason: "cancelled",
      closed_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
    });
    const sys = mintSystemContext({ job: "retention-status-test" });
    await writePlatformMeta(sys, RETENTION_HEARTBEAT_KEY, NOW.toISOString());
    await writePlatformMeta(
      sys,
      RETENTION_COUNTS_KEY,
      JSON.stringify({ capHit: true, failedSteps: [] }),
    );

    const status = await retentionStatus(NOW);
    expect(status).toEqual({
      last_success: NOW.toISOString(),
      cap_hit: true,
      overdue_closed_orgs: 1,
    });
    // Counts only: no org id field of any kind.
    expect(Object.keys(status).sort()).toEqual([
      "cap_hit",
      "last_success",
      "overdue_closed_orgs",
    ]);
  });

  it("reads unparseable counts as cap_hit false", async (ctx) => {
    if (!st) return ctx.skip();
    await writePlatformMeta(
      mintSystemContext({ job: "retention-status-test" }),
      RETENTION_COUNTS_KEY,
      "not json",
    );
    expect((await retentionStatus(NOW)).cap_hit).toBe(false);
  });
});
