// 09-14: agreements:verify core on the real PocketBase 0.39.11 binary (AGR-01, AGR-04,
// AGR-05; CONTEXT A2-Q4, Specifics; RESEARCH Pattern 6). Org A signs (signup) and re-accepts
// a TOS v2; verify reports MATCH on both. Then each tampering case alters one stored thing,
// checks it is detected, and puts it back. The audit case runs last (the row stays deleted).
import "@cds/addon-registry/server";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, NotFound } from "@cds/core";
import { POLICY_SET, type PolicySet } from "@cds/core/legal";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintPlatformContext,
  mintSystemContext,
  type PlatformContext,
} from "../src/context";
import { runRetentionJob } from "../src/jobs/retention";
import { readSignedCopy, signAgreement, type SignInput } from "../src/legal";
import { markOrgClosed } from "../src/org-closure";
import { verifySignatures } from "../src/legal/verify";
import {
  __setPolicySetForTests,
  activeConsentVersion,
  activePolicies,
  storedPolicyVersion,
} from "../src/legal/policy-versions";
import { LocalDiskStore } from "../src/storage/local-disk";
import { tenantAgreementKey } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let dir = "";
let store: LocalDiskStore;
let staff: PlatformContext;
let ids: string[] = [];

const sha = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");

function withTosV2(): PolicySet {
  const v1 = POLICY_SET.policies.find((p) => p.key === "terms-of-service")!;
  const bodyMd = `${v1.bodyMd}\n\nVersion 2 adds one sentence.\n`;
  return {
    policies: [
      ...POLICY_SET.policies,
      {
        ...v1,
        version: 2,
        changes: "Adds one sentence.",
        bodyMd,
        sha256: sha(bodyMd),
      },
    ],
    consents: POLICY_SET.consents,
  };
}

async function input(keys?: readonly string[]): Promise<SignInput> {
  const c = await activeConsentVersion();
  return {
    policies: (await activePolicies())
      .filter((p) => !keys || keys.includes(p.key))
      .map((p) => ({ key: p.key, version: p.version, sha256: p.sha256 })),
    consent: { version: c.version, sha256: c.sha256 },
    signerName: "Ana Rivera",
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0 vitest",
    authMethod: "otp",
  };
}

const run = (deps: Parameters<typeof verifySignatures>[2] = {}) =>
  verifySignatures(staff, seed.A.org, { store, ...deps });

async function verifyAudits(): Promise<number> {
  return (
    await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'agreement.verify' && organization = {:org}",
        {
          org: seed.A.org,
        },
      ),
    })
  ).length;
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  dir = await mkdtemp(join(tmpdir(), "cds-agr-verify-"));
  store = new LocalDiskStore(dir);
  staff = mintPlatformContext({
    actor: seed.B.owner,
    staffRole: "support_agent",
    ip: "10.0.0.1",
  });
  const first = await signAgreement(seed.ctxA, await input(), {
    store,
    now: () => new Date("2026-10-08T19:14:03.000Z"),
  });
  __setPolicySetForTests(withTosV2());
  const second = await signAgreement(
    seed.ctxA,
    await input(["terms-of-service"]),
    { store, now: () => new Date("2027-01-04T15:02:41.000Z") },
  );
  __setPolicySetForTests(null);
  ids = [first.signatureId, second.signatureId];
}, 120_000);

afterAll(async () => {
  __setPolicySetForTests(null);
  await inst?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("verifySignatures (09-14)", () => {
  it("genuine signings: MATCH on both hashes, no problems, one audit row per run", async (t) => {
    if (!inst) return t.skip();
    const before = await verifyAudits();
    const r = await run();
    expect(r.orgName).toBe("Org A");
    expect(r.checks).toHaveLength(2);
    const [a, b] = r.checks;
    expect(a!.id).toBe(ids[0]);
    expect(a!.signedAt).toBe("2026-10-08T19:14:03.000Z");
    expect(a!.signerName).toBe("Ana Rivera");
    expect(a!.kind).toBe("signup");
    expect(a!.ip).toBe("203.0.113.7");
    expect(a!.codes).toBe("SA1 AUP1 TOS1 SUB1 DPA1 ESC1");
    expect(b!.codes).toBe("TOS2 ESC1");
    expect(b!.kind).toBe("reaccept");
    for (const c of r.checks) {
      expect(c.evidence).toBe("MATCH");
      expect(c.document).toBe("MATCH");
      expect(c.problems).toEqual([]);
    }
    expect(await verifyAudits()).toBe(before + 1);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'agreement.verify' && organization = {:org}",
        {
          org: seed.A.org,
        },
      ),
    });
    const meta = audit[0]!.meta as Record<string, unknown>;
    expect(meta).toMatchObject({ signings: 2, failures: 0 });
    expect(audit[0]!.actor).toBe(seed.B.owner);
  });

  it("an overwritten HTML copy is a document MISMATCH", async (t) => {
    if (!inst) return t.skip();
    const key = tenantAgreementKey(seed.A.org, ids[0]!, "html");
    const original = (await store.get(key))!;
    await store.put(key, "<p>altered</p>");
    try {
      const c = (await run()).checks[0]!;
      expect(c.document).toBe("MISMATCH");
      expect(c.evidence).toBe("MATCH");
      const stored = (
        await pb.collection("agreement_signatures").getOne(ids[0]!)
      ).document_sha256 as string;
      expect(c.problems).toContain(
        `document hash differs (stored ${stored.slice(0, 4)}…, computed ${sha("<p>altered</p>").slice(0, 4)}…)`,
      );
    } finally {
      await store.put(key, original);
    }
    expect((await run()).checks[0]!.document).toBe("MATCH");
  });

  it("evidence re-serialised with whitespace is an evidence MISMATCH", async (t) => {
    if (!inst) return t.skip();
    const key = tenantAgreementKey(seed.A.org, ids[0]!, "json");
    const original = (await store.get(key))!;
    const pretty = JSON.stringify(
      JSON.parse(new TextDecoder().decode(original)),
      null,
      2,
    );
    await store.put(key, pretty);
    try {
      const c = (await run()).checks[0]!;
      expect(c.evidence).toBe("MISMATCH");
      expect(c.problems.some((p) => p.includes("not canonical"))).toBe(true);
      expect(
        c.problems.some((p) => p.startsWith("evidence hash differs")),
      ).toBe(true);
    } finally {
      await store.put(key, original);
    }
  });

  it("evidence that disagrees with the row is reported", async (t) => {
    if (!inst) return t.skip();
    const key = tenantAgreementKey(seed.A.org, ids[0]!, "json");
    const original = (await store.get(key))!;
    const ev = JSON.parse(new TextDecoder().decode(original)) as Record<
      string,
      unknown
    >;
    // Rewritten canonically with a different IP: the hash differs and so does the field.
    const { canonicalJson } = await import("@cds/core/legal");
    await store.put(key, canonicalJson({ ...ev, ip: "198.51.100.1" }));
    try {
      const c = (await run()).checks[0]!;
      expect(c.evidence).toBe("MISMATCH");
      expect(c.problems).toContain("evidence ip differs from the record");
    } finally {
      await store.put(key, original);
    }
  });

  it("a deleted evidence JSON is missing", async (t) => {
    if (!inst) return t.skip();
    const key = tenantAgreementKey(seed.A.org, ids[1]!, "json");
    const original = (await store.get(key))!;
    await store.delete(key);
    try {
      const c = (await run()).checks[1]!;
      expect(c.evidence).toBe("missing");
      expect(c.document).toBe("MATCH");
      expect(c.problems).toContain("evidence missing");
    } finally {
      await store.put(key, original);
    }
  });

  it("a policy hash that differs from policy_versions is reported", async (t) => {
    if (!inst) return t.skip();
    const r = await run({
      storedPolicyVersion: async (key, version) =>
        key === "terms-of-service" && version === 1
          ? { sha256: "f".repeat(64), status: "retired" }
          : storedPolicyVersion(key, version),
    });
    expect(r.checks[0]!.problems).toEqual([
      "policy TOS v1 hash differs from the stored version",
    ]);
    expect(r.checks[1]!.problems).toEqual([]);
  });

  it("refuses non-staff and unknown orgs", async (t) => {
    if (!inst) return t.skip();
    const notStaff = mintPlatformContext({
      actor: seed.A.owner,
      staffRole: "nobody" as PlatformContext["staffRole"],
      ip: "10.0.0.1",
    });
    await expect(
      verifySignatures(notStaff, seed.A.org, { store }),
    ).rejects.toThrow(Forbidden);
    await expect(
      verifySignatures(seed.ctxA as unknown as PlatformContext, seed.A.org, {
        store,
      }),
    ).rejects.toThrow(Forbidden);
    await expect(
      verifySignatures(staff, "zzzzzzzzzzzzzzz", { store }),
    ).rejects.toThrow(NotFound);
    await expect(
      verifySignatures(staff, "not an id", { store }),
    ).rejects.toThrow(NotFound);
  });

  it("org B has no signings", async (t) => {
    if (!inst) return t.skip();
    const r = await verifySignatures(staff, seed.B.org, { store });
    expect(r.orgName).toBe("Org B");
    expect(r.checks).toEqual([]);
  });

  it("a closed org deleted by the retention job still verifies and downloads (CR-A01)", async (t) => {
    if (!inst) return t.skip();
    const now = new Date();
    await markOrgClosed(
      mintSystemContext({ job: "test" }),
      seed.A.org,
      "cancelled",
      {
        now: new Date(now.getTime() - 31 * 24 * 3_600_000),
      },
    );
    const job = await runRetentionJob({
      now,
      deps: { privateStore: store, publicStore: store, agreementStore: store },
    });
    expect(job.orgsDeleted).toBe(1);
    expect(job.keptAgreementsForDeletedOrgs).toBe(2);
    await expect(
      pb.collection("organizations").getOne(seed.A.org),
    ).rejects.toThrow();

    const r = await run();
    expect(r.orgDeleted).toBe(true);
    expect(r.orgName).toBe("Org A");
    expect(r.checks.map((c) => c.id)).toEqual(ids);
    for (const c of r.checks) {
      expect(c.evidence).toBe("MATCH");
      expect(c.document).toBe("MATCH");
      // The agreement.sign row survives with its org relation cleared (CR-A02).
      expect(c.problems).toEqual([]);
    }
    const signRows = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'agreement.sign' && target_id = {:id}", {
        id: ids[0]!,
      }),
    });
    expect(signRows).toHaveLength(1);
    expect(signRows[0]!.organization).toBe("");
    // The verify run's own audit row is written without the (gone) org relation.
    const verifyRows = await pb.collection("audit_log").getFullList({
      filter: "action = 'agreement.verify' && organization = ''",
    });
    expect(
      verifyRows.some(
        (a) => (a.meta as Record<string, unknown>).org === seed.A.org,
      ),
    ).toBe(true);

    const copy = await readSignedCopy(staff, ids[0]!, seed.A.org, { store });
    expect(copy).not.toBeNull();
    expect(copy!.filename).toBe("CDS-agreement-org-a-2026-10-08.html");
    expect(new TextDecoder().decode(copy!.bytes)).toContain("Ana Rivera");
  });

  it("a missing audit row is reported (runs last)", async (t) => {
    if (!inst) return t.skip();
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'agreement.sign' && target_id = {:id}", {
        id: ids[1]!,
      }),
    });
    expect(rows).toHaveLength(1);
    await pb.collection("audit_log").delete(rows[0]!.id);
    const c = (await run()).checks[1]!;
    expect(c.problems).toEqual(["audit record missing"]);
    expect(c.evidence).toBe("MATCH");
    expect(c.document).toBe("MATCH");
  });
});
