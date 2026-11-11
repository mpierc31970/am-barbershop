// 09-08: compiled policy texts mirrored into policy_versions on the real PocketBase 0.39.11
// binary (AGR-01, AGR-07, D81; CONTEXT A1-Q2; RESEARCH Open Question 4). The tests run in
// order on one instance: policy_versions rows can never be deleted (09-03 hook), so each step
// builds on the rows the previous step left behind.
import { createHash } from "node:crypto";
import { POLICY_SET, type PolicySet } from "@cds/core/legal";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { sha256Hex } from "../src/legal";
import {
  __setPolicySetForTests,
  activeConsentVersion,
  activePolicies,
  PolicyVersionConflict,
  storedPolicyVersion,
  syncPolicyVersions,
} from "../src/legal/policy-versions";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;

beforeAll(async () => {
  inst = await bootPb();
  resetClientForTests();
}, 120_000);

afterAll(async () => {
  __setPolicySetForTests(null);
  await inst?.stop();
});

afterEach(() => {
  __setPolicySetForTests(null);
});

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** POLICY_SET plus a terms-of-service v2 (the v2 bump fixture). */
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

/** The v2 set with dpa v1's body edited in place (the forbidden change). */
function withEditedDpa(): PolicySet {
  const base = withTosV2();
  return {
    policies: base.policies.map((p) =>
      p.key === "dpa" && p.version === 1
        ? {
            ...p,
            bodyMd: `${p.bodyMd} edited`,
            sha256: sha(`${p.bodyMd} edited`),
          }
        : p,
    ),
    consents: base.consents,
  };
}

async function rows() {
  const pb = await superuser();
  return pb.collection("policy_versions").getFullList({ sort: "key,version" });
}

describe("sha256Hex", () => {
  it("hashes utf8 strings and bytes", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
  });
});

describe("syncPolicyVersions (CONTEXT A1-Q2)", () => {
  it("first sync inserts every policy and the consent, all active, with audit rows", async () => {
    const r = await syncPolicyVersions();
    expect(r).toEqual({ inserted: 6, retired: 0, unchanged: 0 });
    const stored = await rows();
    expect(stored).toHaveLength(6);
    const compiled = [...POLICY_SET.policies, ...POLICY_SET.consents];
    for (const c of compiled) {
      const row = stored.find(
        (s) => s.key === c.key && s.version === c.version,
      );
      expect(row?.sha256).toBe(c.sha256);
      expect(row?.status).toBe("active");
      expect(sha256Hex(String(row?.body_md))).toBe(c.sha256);
    }
    const consent = stored.find((s) => s.key === "esign-consent");
    expect(consent?.summary).toEqual([POLICY_SET.consents[0]!.label]);
    const pb = await superuser();
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = {:a}", { a: "policy_versions.publish" }),
    });
    expect(audits).toHaveLength(6);
    expect(audits[0]?.meta?.job).toBe("policy-sync");
  });

  it("a second sync changes nothing", async () => {
    expect(await syncPolicyVersions()).toEqual({
      inserted: 0,
      retired: 0,
      unchanged: 6,
    });
    expect(await rows()).toHaveLength(6);
  });

  it("serves the active versions in D216 order and the consent", async () => {
    const active = await activePolicies();
    expect(active.map((p) => p.key)).toEqual([
      "service-agreement",
      "acceptable-use",
      "terms-of-service",
      "subscription-terms",
      "dpa",
    ]);
    expect((await activeConsentVersion()).key).toBe("esign-consent");
    const tos = await storedPolicyVersion("terms-of-service", 1);
    expect(tos?.status).toBe("active");
    expect(await storedPolicyVersion("terms-of-service", 9)).toBeNull();
  });

  it("a v2 bump inserts v2 and retires v1", async () => {
    __setPolicySetForTests(withTosV2());
    expect(await syncPolicyVersions()).toEqual({
      inserted: 1,
      retired: 1,
      unchanged: 6,
    });
    expect((await storedPolicyVersion("terms-of-service", 1))?.status).toBe(
      "retired",
    );
    expect((await storedPolicyVersion("terms-of-service", 2))?.status).toBe(
      "active",
    );
    const tos = (await activePolicies()).find(
      (p) => p.key === "terms-of-service",
    );
    expect(tos?.version).toBe(2);
    const pb = await superuser();
    const retire = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = {:a}", { a: "policy_versions.retire" }),
    });
    expect(retire).toHaveLength(1);
  });

  it("an edited published version throws before any write and blocks signing", async () => {
    __setPolicySetForTests(withEditedDpa());
    const before = await rows();
    const err = await syncPolicyVersions().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PolicyVersionConflict);
    expect((err as PolicyVersionConflict).code).toBe("policy_version_conflict");
    expect((err as Error).message).toContain("dpa v1");
    expect(await rows()).toEqual(before);
    await expect(activePolicies()).rejects.toBeInstanceOf(
      PolicyVersionConflict,
    );
    await expect(activeConsentVersion()).rejects.toBeInstanceOf(
      PolicyVersionConflict,
    );
    // Fixed set: signing works again.
    __setPolicySetForTests(withTosV2());
    expect(await activePolicies()).toHaveLength(5);
  });
});
