// 09-10: the signing chokepoint and the checkout gate on the real PocketBase 0.39.11 binary
// (AGR-02, AGR-03, AGR-04, AGR-05, AGR-07, D80, D81, D283, D287; CONTEXT A2-Q1..Q5, A3-Q1,
// A3-Q2; RESEARCH Pattern 2, Pattern 5). The cases run in order on one instance:
// agreement_signatures rows can never be deleted (09-03 hook), so each step builds on the
// rows the previous one left behind.
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgreementRequired,
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
} from "@cds/core";
import { canonicalJson, POLICY_SET, type PolicySet } from "@cds/core/legal";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  mintPlatformContext,
  type OrgContext,
} from "../src/context";
import {
  AgreementAlreadySigned,
  AgreementStale,
  agreementStatus,
  isAgreementDocument,
  listAgreementDocuments,
  listDocuments,
  listSignatureRows,
  orderSnapshotFor,
  readSignedCopy,
  requireCurrentSignature,
  signAgreement,
  type SignInput,
} from "../src/legal";
import {
  __setPolicySetForTests,
  activeConsentVersion,
  activePolicies,
} from "../src/legal/policy-versions";
import { platformUrl } from "../src/email/env";
import { captureTransport } from "../src/email/transport";
import { LocalDiskStore } from "../src/storage/local-disk";
import { tenantAgreementKey, tenantAgreementPrefix } from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let dir = "";
let store: LocalDiskStore;

const sha = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");

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

const T0 = new Date("2026-10-08T15:30:00.000Z");
const T1 = new Date("2027-02-01T09:00:00.000Z");

function ctxWith(
  role: "owner" | "admin" | "editor" | "viewer",
  extra: { impersonator?: string } = {},
): OrgContext {
  return mintOrgContext({
    orgId: seed.A.org,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: "127.0.0.1",
    ...extra,
  });
}

async function fullInput(over: Partial<SignInput> = {}): Promise<SignInput> {
  const policies = (await activePolicies()).map((p) => ({
    key: p.key,
    version: p.version,
    sha256: p.sha256,
  }));
  const c = await activeConsentVersion();
  return {
    policies,
    consent: { version: c.version, sha256: c.sha256 },
    signerName: "Ana Rivera",
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0 vitest",
    authMethod: "otp",
    ...over,
  };
}

async function rowsOf(org: string) {
  return pb.collection("agreement_signatures").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
    sort: "signed_at,id",
  });
}

async function objectsOf(org: string): Promise<string[]> {
  return (await store.list(tenantAgreementPrefix(org))).map((o) => o.key);
}

const checkout = async (ctx: OrgContext) => {
  await requireCurrentSignature(ctx);
  return "charged";
};

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  dir = await mkdtemp(join(tmpdir(), "cds-agreements-"));
  store = new LocalDiskStore(dir);
}, 120_000);

afterAll(async () => {
  __setPolicySetForTests(null);
  await inst?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("agreements: status, gate and signing (09-10)", () => {
  it("an unsigned org is refused at checkout", async (t) => {
    if (!inst) return t.skip();
    const s = await agreementStatus(seed.ctxA);
    expect(s.state).toBe("unsigned");
    expect(s.missing.map((m) => m.key)).toEqual(
      (await activePolicies()).map((p) => p.key),
    );
    expect(s.missing).toHaveLength(5);
    expect(s.missing.every((m) => m.previousVersion === null)).toBe(true);
    expect(s.lastSignedAt).toBeNull();
    await expect(requireCurrentSignature(seed.ctxA)).rejects.toThrow(
      AgreementRequired,
    );
    await expect(checkout(seed.ctxA)).rejects.toThrow(AgreementRequired);
  });

  it("the order snapshot is null while the org has no priced path", async (t) => {
    if (!inst) return t.skip();
    expect(await orderSnapshotFor(seed.ctxA)).toBeNull();
  });

  it("an admin and an impersonated owner cannot sign; nothing is written", async (t) => {
    if (!inst) return t.skip();
    const input = await fullInput();
    await expect(
      signAgreement(ctxWith("admin"), input, { store }),
    ).rejects.toThrow(Forbidden);
    await expect(
      signAgreement(ctxWith("owner", { impersonator: seed.B.owner }), input, {
        store,
      }),
    ).rejects.toThrow(ImpersonationDenied);
    expect(await rowsOf(seed.A.org)).toHaveLength(0);
    expect(await objectsOf(seed.A.org)).toEqual([]);
  });

  it("a stale posted set is refused and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const good = await fullInput();
    const wrongSha = {
      ...good,
      policies: good.policies.map((p, i) =>
        i === 0 ? { ...p, sha256: "0".repeat(64) } : p,
      ),
    };
    const missingOne = { ...good, policies: good.policies.slice(1) };
    const staleConsent = {
      ...good,
      consent: { ...good.consent, sha256: "1".repeat(64) },
    };
    for (const bad of [wrongSha, missingOne, staleConsent]) {
      await expect(
        signAgreement(seed.ctxA, bad, { store, now: () => T0 }),
      ).rejects.toThrow(AgreementStale);
    }
    const err = await signAgreement(seed.ctxA, missingOne, { store }).catch(
      (e: unknown) => e,
    );
    expect((err as AgreementStale).code).toBe("agreement_stale");
    expect((err as Error).message).toBe(
      "One of these policies was updated while you were reading. We've loaded the new version; please review it and tick it again.",
    );
    expect(await rowsOf(seed.A.org)).toHaveLength(0);
    expect(await objectsOf(seed.A.org)).toEqual([]);
  });

  it("a too-short signer name is refused", async (t) => {
    if (!inst) return t.skip();
    await expect(
      signAgreement(seed.ctxA, await fullInput({ signerName: "A" }), { store }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      signAgreement(
        seed.ctxA,
        await fullInput({ signerName: " \u0000\u0007 " }),
        { store },
      ),
    ).rejects.toThrow("Type your full name (at least 2 characters).");
    expect(await rowsOf(seed.A.org)).toHaveLength(0);
  });

  it("the owner signs: row, evidence JSON, HTML copy and audit row", async (t) => {
    if (!inst) return t.skip();
    const input = await fullInput({
      signerName: "  Ana\u0000 \t Rivera​ ",
      // Ignored: the org always comes from ctx (invariant 1).
      ...({ organization: seed.B.org } as object),
    });
    const res = await signAgreement(seed.ctxA, input, {
      store,
      now: () => T0,
    });
    expect(res.signatureId).toMatch(/^[a-z0-9]{15}$/);
    expect(res.kind).toBe("signup");
    expect(res.signedAt).toBe(T0.toISOString());
    expect(res.policies.map((p) => p.key)).toEqual(
      (await activePolicies()).map((p) => p.key),
    );

    const rows = await rowsOf(seed.A.org);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(res.signatureId);
    expect(row.organization).toBe(seed.A.org);
    expect(row.signer).toBe(seed.A.owner);
    expect(row.signer_email).toBe("owner-a@cds.test");
    expect(row.signer_name).toBe("Ana Rivera");
    expect(row.org_name).toBe("Org A");
    expect(row.ip).toBe("203.0.113.7");
    expect(row.user_agent).toBe("Mozilla/5.0 vitest");
    expect(row.auth_method).toBe("otp");
    expect(row.kind).toBe("signup");
    expect(
      new Date(String(row.signed_at).replace(" ", "T")).toISOString(),
    ).toBe(T0.toISOString());
    expect(
      new Date(String(row.retain_until).replace(" ", "T")).toISOString(),
    ).toBe("2033-10-08T15:30:00.000Z");
    expect(row.document_key).toBe(
      tenantAgreementKey(seed.A.org, res.signatureId, "html"),
    );
    expect(row.evidence_sha256).toBe(res.evidenceSha256);
    expect(row.document_sha256).toBe(res.documentSha256);
    expect((row.policies as { key: string }[]).map((p) => p.key)).toEqual(
      input.policies.map((p) => p.key),
    );

    const json = await store.get(
      tenantAgreementKey(seed.A.org, res.signatureId, "json"),
    );
    const html = await store.get(
      tenantAgreementKey(seed.A.org, res.signatureId, "html"),
    );
    expect(json).not.toBeNull();
    expect(html).not.toBeNull();
    const text = new TextDecoder().decode(json!);
    expect(sha(json!)).toBe(row.evidence_sha256);
    expect(canonicalJson(JSON.parse(text))).toBe(text);
    const ev = JSON.parse(text) as Record<string, unknown>;
    expect(ev.organization).toBe(seed.A.org);
    expect(ev.signer_name).toBe("Ana Rivera");
    expect(ev.order_snapshot).toBeNull();
    expect(sha(html!)).toBe(row.document_sha256);
    expect(await objectsOf(seed.A.org)).toHaveLength(2);

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'agreement.sign' && target_id = {:id}", {
        id: res.signatureId,
      }),
    });
    expect(audit).toHaveLength(1);
    const meta = audit[0]!.meta as Record<string, unknown>;
    expect(audit[0]!.organization).toBe(seed.A.org);
    expect(audit[0]!.target_collection).toBe("agreement_signatures");
    expect(meta.evidence_sha256).toBe(res.evidenceSha256);
    expect(meta.document_sha256).toBe(res.documentSha256);
    expect(meta.kind).toBe("signup");
    expect(meta.policies).toBe("SA1 AUP1 TOS1 SUB1 DPA1");

    const s = await agreementStatus(seed.ctxA);
    expect(s.state).toBe("current");
    expect(s.missing).toEqual([]);
    expect(s.consentCurrent).toBe(true);
    expect(s.lastSignerName).toBe("Ana Rivera");
    expect(s.lastSignedAt).toBe(T0.toISOString());
    await expect(checkout(seed.ctxA)).resolves.toBe("charged");
    // Org B is untouched by org A's signature.
    expect((await agreementStatus(seed.ctxB)).state).toBe("unsigned");
    expect(await rowsOf(seed.B.org)).toHaveLength(0);
  });

  it("signing the same set again is refused", async (t) => {
    if (!inst) return t.skip();
    await expect(
      signAgreement(seed.ctxA, await fullInput(), { store }),
    ).rejects.toThrow(AgreementAlreadySigned);
    expect(await rowsOf(seed.A.org)).toHaveLength(1);
    expect(await objectsOf(seed.A.org)).toHaveLength(2);
  });

  it("every member role reads the status", async (t) => {
    if (!inst) return t.skip();
    for (const role of ["admin", "editor", "viewer"] as const) {
      expect((await agreementStatus(ctxWith(role))).state).toBe("current");
    }
  });

  it("a v2 policy makes the org outdated; re-acceptance signs only the change", async (t) => {
    if (!inst) return t.skip();
    const firstBefore = (await rowsOf(seed.A.org))[0]!;
    __setPolicySetForTests(withTosV2());
    const s = await agreementStatus(seed.ctxA);
    expect(s.state).toBe("outdated");
    expect(s.missing).toEqual([
      {
        key: "terms-of-service",
        version: 2,
        title: expect.any(String) as string,
        changes: "Adds one sentence.",
        previousVersion: 1,
        previousSignedAt: T0.toISOString(),
      },
    ]);
    await expect(checkout(seed.ctxA)).rejects.toThrow(AgreementRequired);

    // Posting all five while outdated is stale (strict set, choice 1).
    await expect(
      signAgreement(seed.ctxA, await fullInput(), { store }),
    ).rejects.toThrow(AgreementStale);

    const all = await fullInput();
    const res = await signAgreement(
      seed.ctxA,
      {
        ...all,
        policies: all.policies.filter((p) => p.key === "terms-of-service"),
      },
      { store, now: () => T1 },
    );
    expect(res.kind).toBe("reaccept");
    expect(res.policies).toEqual([
      { key: "terms-of-service", version: 2, title: expect.any(String) },
    ]);
    const rows = await rowsOf(seed.A.org);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(firstBefore);
    expect(rows[1]!.kind).toBe("reaccept");
    expect(
      (rows[1]!.policies as { key: string; version: number }[]).map(
        (p) => `${p.key}@${p.version}`,
      ),
    ).toEqual(["terms-of-service@2"]);
    expect(await objectsOf(seed.A.org)).toHaveLength(4);

    const after = await agreementStatus(seed.ctxA);
    expect(after.state).toBe("current");
    expect(after.lastSignedAt).toBe(T1.toISOString());
    await expect(checkout(seed.ctxA)).resolves.toBe("charged");

    const listed = await listSignatureRows(seed.ctxA);
    expect(listed.map((r) => r.id)).toEqual([rows[1]!.id, rows[0]!.id]);
    __setPolicySetForTests(null);
  });
});

describe("agreements: documents list and signed copy (09-13)", () => {
  it("listDocuments: newest first, re-signed policy only, hub download route", async (t) => {
    if (!inst) return t.skip();
    __setPolicySetForTests(withTosV2());
    try {
      const rows = await rowsOf(seed.A.org); // oldest first
      const all = await listDocuments(seed.ctxA);
      const docs = all.filter(isAgreementDocument);
      expect(docs).toEqual(all); // org A has no invoices
      expect(docs).toHaveLength(2);
      const [re, first] = docs;
      expect(re!.id).toBe(rows[1]!.id);
      expect(first!.id).toBe(rows[0]!.id);
      expect(re!.kind).toBe("agreement");
      expect(re!.title).toBe("Signed agreement");
      expect(re!.signingKind).toBe("reaccept");
      expect(first!.signingKind).toBe("signup");
      expect(re!.versions).toEqual([
        {
          key: "terms-of-service",
          title: expect.any(String) as string,
          version: 2,
        },
      ]);
      expect(re!.versions[0]!.title).not.toBe("terms-of-service");
      expect(first!.versions).toHaveLength(5);
      expect(re!.signedAt).toBe(T1.toISOString());
      expect(first!.signedAt).toBe(T0.toISOString());
      expect(re!.signerName).toBe("Ana Rivera");
      expect(re!.signerEmail).toBe("owner-a@cds.test");
      expect(re!.evidenceSha256).toBe(rows[1]!.evidence_sha256);
      expect(re!.downloadUrl).toBe(`/hub/agreement/download/${re!.id}`);
      expect(await listDocuments(ctxWith("admin"))).toEqual(all);
      // WR-D06: the Legal screens' reader gives the same signings, without the invoices.
      expect(await listAgreementDocuments(seed.ctxA)).toEqual(docs);
    } finally {
      __setPolicySetForTests(null);
    }
  });

  it("listDocuments: editor and viewer are refused; org B sees nothing of org A", async (t) => {
    if (!inst) return t.skip();
    await expect(listDocuments(ctxWith("editor"))).rejects.toThrow(Forbidden);
    await expect(listDocuments(ctxWith("viewer"))).rejects.toThrow(Forbidden);
    // The raw rows (signer email, IP) are authorized in the chokepoint too (WR-A05).
    await expect(listSignatureRows(ctxWith("editor"))).rejects.toThrow(
      Forbidden,
    );
    await expect(listSignatureRows(ctxWith("viewer"))).rejects.toThrow(
      Forbidden,
    );
    await expect(listSignatureRows(ctxWith("admin"))).resolves.toBeDefined();
    // agreementStatus stays readable by every member (the re-accept notice).
    await expect(agreementStatus(ctxWith("editor"))).resolves.toBeDefined();
    expect(await listDocuments(seed.ctxB)).toEqual([]);
    await expect(listAgreementDocuments(ctxWith("editor"))).rejects.toThrow(
      Forbidden,
    );
    expect(await listAgreementDocuments(seed.ctxB)).toEqual([]);
  });

  it("readSignedCopy: own org bytes and filename; other org null; editor refused", async (t) => {
    if (!inst) return t.skip();
    const row = (await rowsOf(seed.A.org))[0]!;
    const copy = await readSignedCopy(seed.ctxA, row.id, undefined, { store });
    expect(copy).not.toBeNull();
    expect(sha(copy!.bytes)).toBe(row.document_sha256);
    expect(copy!.filename).toBe("CDS-agreement-org-a-2026-10-08.html");
    expect(copy!.signedAt).toBe(T0.toISOString());
    expect(
      await readSignedCopy(ctxWith("admin"), row.id, undefined, { store }),
    ).not.toBeNull();
    expect(
      await readSignedCopy(seed.ctxB, row.id, undefined, { store }),
    ).toBeNull();
    // A staff-only orgId argument is ignored for a tenant context.
    expect(
      await readSignedCopy(seed.ctxB, row.id, seed.A.org, { store }),
    ).toBeNull();
    await expect(
      readSignedCopy(ctxWith("editor"), row.id, undefined, { store }),
    ).rejects.toThrow(Forbidden);
    expect(
      await readSignedCopy(seed.ctxA, "zzzzzzzzzzzzzzz", undefined, { store }),
    ).toBeNull();
    expect(
      await readSignedCopy(seed.ctxA, "not an id", undefined, { store }),
    ).toBeNull();
  });

  it("readSignedCopy: staff support_agent reads with orgId and is audited", async (t) => {
    if (!inst) return t.skip();
    const row = (await rowsOf(seed.A.org))[0]!;
    const staff = mintPlatformContext({
      actor: seed.B.owner,
      staffRole: "support_agent",
      ip: "10.0.0.1",
    });
    const copy = await readSignedCopy(staff, row.id, seed.A.org, { store });
    expect(sha(copy!.bytes)).toBe(row.document_sha256);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'agreement.download_staff' && target_id = {:id}",
        { id: row.id },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.organization).toBe(seed.A.org);
    expect(audit[0]!.actor).toBe(seed.B.owner);
    // Wrong org for the id: not found.
    expect(
      await readSignedCopy(staff, row.id, seed.B.org, { store }),
    ).toBeNull();
    await expect(
      readSignedCopy(staff, row.id, undefined, { store }),
    ).rejects.toThrow(InvalidInput);
    const notStaff = mintPlatformContext({
      actor: seed.B.owner,
      staffRole: "billing" as never,
      ip: "10.0.0.1",
    });
    await expect(
      readSignedCopy(notStaff, row.id, seed.A.org, { store }),
    ).rejects.toThrow(Forbidden);
  });

  it("readSignedCopy: a missing HTML object gives null and logs the id only", async (t) => {
    if (!inst) return t.skip();
    const row = (await rowsOf(seed.A.org))[0]!;
    const emptyDir = await mkdtemp(join(tmpdir(), "cds-agreements-empty-"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const copy = await readSignedCopy(seed.ctxA, row.id, undefined, {
        store: new LocalDiskStore(emptyDir),
      });
      expect(copy).toBeNull();
      const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).toContain(row.id);
      expect(logged).not.toContain("owner-a@cds.test");
    } finally {
      spy.mockRestore();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("agreements: agreement.signed email (09-13)", () => {
  it("a signing emails the signer the download link and the proof code", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const ctxB = seed.ctxB;
    const res = await signAgreement(ctxB, await fullInput(), {
      store,
      now: () => T0,
      transport,
    });
    const mails = transport.sent.filter((m) => m.type === "agreement.signed");
    expect(mails).toHaveLength(1);
    const m = mails[0]!;
    expect(m.to).toBe("owner-b@cds.test");
    expect(m.subject).toBe("Your signed CDS agreement");
    const link = platformUrl(`/hub/agreement/download/${res.signatureId}`);
    expect(m.text).toContain(link);
    expect(m.text).toContain(res.evidenceSha256);
    expect(m.text).toContain("Hi Ana,");
    expect(m.text).toContain("for Org B on 8 Oct 2026 at 3:30 pm UTC.");
    expect(m.preheader).toBe(
      "Signed 8 Oct 2026 for Org B. Download your copy any time.",
    );
    expect(m.text).toMatch(/, version 1/);
  });

  it("a failing transport never fails the signing; the failure logs the id only", async (t) => {
    if (!inst) return t.skip();
    __setPolicySetForTests(withTosV2());
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const all = await fullInput();
      const res = await signAgreement(
        seed.ctxB,
        {
          ...all,
          policies: all.policies.filter((p) => p.key === "terms-of-service"),
        },
        {
          store,
          now: () => T1,
          transport: {
            send: () => Promise.reject(new Error("smtp down")),
          },
        },
      );
      expect(res.kind).toBe("reaccept");
      const rows = await rowsOf(seed.B.org);
      expect(rows.map((r) => r.id)).toContain(res.signatureId);
      const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).toContain(
        `[legal] agreement.signed email failed for ${res.signatureId}`,
      );
      expect(logged).not.toContain("owner-b@cds.test");
    } finally {
      spy.mockRestore();
      __setPolicySetForTests(null);
    }
  });
});
