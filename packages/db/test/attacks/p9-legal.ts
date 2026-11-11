// P9 legal evidence attacks (09-06, TEN-03, invariant 1).
// agreement_signatures (09-10, T-09-10-04): the generic repo stays read-only; org B's owner
// signs through signAgreement with an input that names org A (cast past the type), and the
// row, its objects and its audit row land in org B only; org A's rows and objects are
// unchanged; org B's list and status never see org A's rows, and org A's status never sees
// org B's signature. Org A never signs here: the suite's final check requires every org A
// row to be unchanged.
// site_policy_acks (09-16, T-09-16-03): the generic repo stays read-only; org B's owner
// acknowledges through acknowledgeSitePolicies with an input that names org A (cast past the
// type), and the row and its audit row land in org B only; org A's rows are unchanged;
// org B's state and public page never reflect org A's ack or business details, and org A's
// never reflect org B's.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { expect } from "vitest";
import { siteContextForHost } from "../../src/content/site-context";
import {
  acknowledgeSitePolicies,
  agreementStatus,
  listSignatureRows,
  readPublishedSitePolicy,
  signAgreement,
  sitePolicyState,
  type SignInput,
} from "../../src/legal";
import {
  activeConsentVersion,
  activePolicies,
} from "../../src/legal/policy-versions";
import { tenantRepo } from "../../src/repository";
import { tenantAgreementPrefix } from "../../src/storage";
import { LocalDiskStore } from "../../src/storage/local-disk";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

let store: LocalDiskStore | null = null;

async function agreementStore(): Promise<LocalDiskStore> {
  store ??= new LocalDiskStore(
    await mkdtemp(join(tmpdir(), "cds-p9-attacks-")),
  );
  return store;
}

/** Sign as org B's owner when org B is not current yet; returns org B's newest row id. */
async function ensureBSigned(env: AttackEnv): Promise<string> {
  const seed = env.seed();
  const B = seed.ctxB;
  const s = await agreementStatus(B);
  if (s.state !== "current") {
    const policies = (await activePolicies())
      .filter((p) => s.missing.some((m) => m.key === p.key))
      .map((p) => ({ key: p.key, version: p.version, sha256: p.sha256 }));
    const c = await activeConsentVersion();
    const input = {
      policies,
      consent: { version: c.version, sha256: c.sha256 },
      signerName: "Bea Intruder",
      ip: "198.51.100.4",
      userAgent: "attack",
      authMethod: "otp",
      // Ignored: the org always comes from ctx (invariant 1).
      organization: seed.A.org,
      orgId: seed.A.org,
    } as unknown as SignInput;
    await signAgreement(B, input, { store: await agreementStore() });
  }
  const rows = await listSignatureRows(B);
  return rows[0]!.id;
}

async function orgARows(env: AttackEnv): Promise<string> {
  const pb = env.pb();
  const rows = await pb.collection("agreement_signatures").getFullList({
    filter: pb.filter("organization = {:org}", { org: env.seed().A.org }),
    sort: "id",
  });
  return JSON.stringify(rows);
}

const B_ACKED_AT = new Date("2030-01-01T00:00:00.000Z");

async function setLegalInputs(
  pb: PocketBase,
  org: string,
  legalName: string,
): Promise<void> {
  const values = { legal_name: legalName, privacy_contact: "privacy@org.test" };
  const res = await pb.collection("business_profile").getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org }),
  });
  const row = res.items[0];
  if (row) await pb.collection("business_profile").update(row.id, values);
  else
    await pb
      .collection("business_profile")
      .create({ organization: org, ...values });
}

let bAckId: string | null = null;

/** Org B's owner acknowledges once (input names org A; ignored). Returns the row id. */
async function ensureBAcked(env: AttackEnv): Promise<string> {
  if (bAckId) return bAckId;
  const seed = env.seed();
  const pb = env.pb();
  await setLegalInputs(pb, seed.B.org, "Bea Legal LLC");
  const input = {
    ip: "198.51.100.4",
    // Ignored: the org always comes from ctx (invariant 1).
    organization: seed.A.org,
    orgId: seed.A.org,
  } as unknown as { ip: string };
  await acknowledgeSitePolicies(seed.ctxB, ADDON_REGISTRY, input, {
    now: () => B_ACKED_AT,
  });
  const rows = await pb.collection("site_policy_acks").getFullList({
    filter: pb.filter("organization = {:org} && ip = '198.51.100.4'", {
      org: seed.B.org,
    }),
    sort: "-acked_at,-id",
  });
  bAckId = rows[0]!.id;
  return bAckId;
}

async function orgAAcks(env: AttackEnv): Promise<string> {
  const pb = env.pb();
  const rows = await pb.collection("site_policy_acks").getFullList({
    filter: pb.filter("organization = {:org}", { org: env.seed().A.org }),
    sort: "id",
  });
  return JSON.stringify(rows);
}

export function attacks(env: AttackEnv): AttackMap {
  return {
    "agreement_signatures:write": async () => {
      const seed = env.seed();
      // The generic repo has no write path and org B cannot get org A's row.
      const repo = tenantRepo("agreement_signatures");
      expect("create" in repo).toBe(false);
      expect("update" in repo).toBe(false);
      expect("delete" in repo).toBe(false);
      await expect(
        repo.get(seed.ctxB, env.seedRecordFor("agreement_signatures").a),
      ).rejects.toThrow(NotFound);
      const pb = env.pb();
      const beforeA = await orgARows(env);
      const id = await ensureBSigned(env);

      const row = await pb.collection("agreement_signatures").getOne(id);
      expect(row.organization).toBe(seed.B.org);
      expect(String(row.document_key)).toContain(`/${seed.B.org}/`);
      const audit = await pb.collection("audit_log").getFullList({
        filter: pb.filter("action = 'agreement.sign' && target_id = {:id}", {
          id,
        }),
      });
      expect(audit.map((a) => a.organization)).toEqual([seed.B.org]);
      expect(await orgARows(env)).toBe(beforeA);
      const s = await agreementStore();
      expect(await s.list(tenantAgreementPrefix(seed.A.org))).toEqual([]);
      expect(
        (await s.list(tenantAgreementPrefix(seed.B.org))).length,
      ).toBeGreaterThanOrEqual(2);
    },
    "agreement_signatures:read": async () => {
      const seed = env.seed();
      const pb = env.pb();
      const bId = await ensureBSigned(env);
      const bRows = (
        await pb.collection("agreement_signatures").getFullList({
          filter: pb.filter("organization = {:org}", { org: seed.B.org }),
          fields: "id",
        })
      ).map((r) => r.id);
      const aSeed = env.seedRecordFor("agreement_signatures").a;

      const listedB = (await listSignatureRows(seed.ctxB)).map((r) => r.id);
      expect(listedB).not.toContain(aSeed);
      expect([...listedB].sort()).toEqual([...bRows].sort());
      expect((await agreementStatus(seed.ctxB)).lastSignerName).toBe(
        "Bea Intruder",
      );

      const listedA = (await listSignatureRows(seed.ctxA)).map((r) => r.id);
      expect(listedA).not.toContain(bId);
      const statusA = await agreementStatus(seed.ctxA);
      expect(statusA.state).not.toBe("current");
      expect(statusA.lastSignerName).not.toBe("Bea Intruder");
    },
    "site_policy_acks:write": async () => {
      const seed = env.seed();
      const pb = env.pb();
      await readOnlyAttack(env, "site_policy_acks")();
      const beforeA = await orgAAcks(env);
      const id = await ensureBAcked(env);
      const row = await pb.collection("site_policy_acks").getOne(id);
      expect(row.organization).toBe(seed.B.org);
      expect(row.user).toBe(seed.B.owner);
      const audit = await pb.collection("audit_log").getFullList({
        filter: pb.filter(
          "action = 'site_policies.publish' && target_id = {:id}",
          { id },
        ),
      });
      expect(audit.map((a) => a.organization)).toEqual([seed.B.org]);
      expect(await orgAAcks(env)).toBe(beforeA);
    },
    "site_policy_acks:read": async () => {
      const seed = env.seed();
      await ensureBAcked(env);
      const stateB = await sitePolicyState(seed.ctxB, ADDON_REGISTRY);
      expect(stateB.ack?.ackedAt).toBe(B_ACKED_AT.toISOString());
      const stateA = await sitePolicyState(seed.ctxA, ADDON_REGISTRY);
      expect(stateA.ack?.ackedAt).not.toBe(B_ACKED_AT.toISOString());

      const pb = env.pb();
      const hostOf = async (id: string) =>
        String((await pb.collection("org_hosts").getOne(id)).hostname);
      const siteB = await siteContextForHost(await hostOf(seed.B.host));
      const siteA = await siteContextForHost(await hostOf(seed.A.host));
      expect(siteB?.orgId).toBe(seed.B.org);
      const pubB = await readPublishedSitePolicy(
        siteB!,
        ADDON_REGISTRY,
        "privacy",
      );
      expect(pubB!.html).toContain("Bea Legal LLC");
      // Org A's details never reach org B's page (org A is never written here).
      const orgAName = String(
        (await pb.collection("organizations").getOne(seed.A.org)).name,
      );
      expect(orgAName).not.toBe("");
      expect(pubB!.html).not.toContain(orgAName);
      const pubA = siteA
        ? await readPublishedSitePolicy(siteA, ADDON_REGISTRY, "privacy")
        : null;
      if (pubA) {
        expect(pubA.html).not.toContain("Bea Legal LLC");
        expect(pubA.lastUpdated).not.toBe(B_ACKED_AT.toISOString());
      }
    },
  };
}
