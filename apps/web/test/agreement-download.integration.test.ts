// /hub/agreement/download/<id> against the real PocketBase 0.39.11 binary (09-18; AGR-04,
// AGR-06; CONTEXT A2-Q4; D-UI-P9-11, D-UI-P9-16; T-09-18-01..04). The route streams the
// stored HTML copy as an attachment to Owner/Admin of the org only. The session module is
// mocked (the real one needs a PocketBase sign-in cookie); the org still comes only from the
// session ctx. The signed copy is written through the real signAgreement into a temp local
// disk store (CDS_STORAGE_DIR), the same store the route reads through getAgreementStore().
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POLICY_SET, type PolicySet } from "@cds/core/legal";
import type { OrgContext } from "@cds/db";
import { activeConsentVersion, activePolicies, signAgreement } from "@cds/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TwoOrgs } from "../../../packages/db/test/fixtures";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import {
  __setPolicySetForTests,
  bootSeededPb,
  captureTransport,
  orgAContextAs,
} from "../../../packages/db/test/seeded";

const state = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("../lib/session", () => ({
  getHubSession: async () => state.session,
  getDeclinedSession: async () => null,
}));

const { GET } =
  await import("../app/(platform)/hub/agreement/download/[id]/route");

const ERR_DOWNLOAD = "We couldn&#x27;t open that copy right now";

let inst: PbInstance | null = null;
let seed: TwoOrgs;
let storageDir: string;
let signatureId = "";
let documentSha = "";
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function ctxA(role: "owner" | "admin" | "editor" | "viewer"): OrgContext {
  return orgAContextAs(seed, role);
}

function sessionOf(ctx: OrgContext, email = "owner-a@cds.test") {
  return {
    ctx,
    email,
    org: { id: ctx.orgId, name: "Org", primaryHost: null },
  };
}

async function call(id: string): Promise<Response> {
  const req = new Request(
    `https://cds.test/hub/agreement/download/${encodeURIComponent(id)}`,
  );
  return GET(req, { params: Promise.resolve({ id }) });
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

/** POLICY_SET plus a terms-of-service v2, so org A is "outdated". */
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
        sha256: createHash("sha256").update(bodyMd).digest("hex"),
      },
    ],
    consents: POLICY_SET.consents,
  };
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-agreement-download-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  seed = booted.seed;
  const c = await activeConsentVersion();
  const signed = await signAgreement(
    seed.ctxA,
    {
      policies: (await activePolicies()).map((p) => ({
        key: p.key,
        version: p.version,
        sha256: p.sha256,
      })),
      consent: { version: c.version, sha256: c.sha256 },
      signerName: "Ana Rivera",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 vitest",
      authMethod: "otp",
    },
    { transport: captureTransport() },
  );
  signatureId = signed.signatureId;
  documentSha = signed.documentSha256;
});

afterAll(async () => {
  __setPolicySetForTests(null);
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("agreement download route (09-18)", () => {
  it("owner gets the exact stored bytes as an attachment", async (t) => {
    if (!inst) return t.skip();
    state.session = sessionOf(ctxA("owner"));
    const res = await call(signatureId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="CDS-agreement-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.html"$/,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(sha(new Uint8Array(await res.arrayBuffer()))).toBe(documentSha);
  });

  it("admin of the org may download; editor and viewer go to /hub", async (t) => {
    if (!inst) return t.skip();
    state.session = sessionOf(ctxA("admin"));
    const ok = await call(signatureId);
    expect(ok.status).toBe(200);
    expect(sha(new Uint8Array(await ok.arrayBuffer()))).toBe(documentSha);
    for (const role of ["editor", "viewer"] as const) {
      state.session = sessionOf(ctxA(role));
      const res = await call(signatureId);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/hub");
      expect((await res.arrayBuffer()).byteLength).toBe(0);
    }
  });

  it("another org's owner gets ERR-DOWNLOAD (404), never the bytes", async (t) => {
    if (!inst) return t.skip();
    state.session = sessionOf(seed.ctxB, "owner-b@cds.test");
    const res = await call(signatureId);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.text();
    expect(body).toContain(ERR_DOWNLOAD);
    expect(body).toContain("/hub/settings?tab=legal");
    expect(body).not.toContain("Ana Rivera");
  });

  it("a malformed or unknown id is ERR-DOWNLOAD (404)", async (t) => {
    if (!inst) return t.skip();
    state.session = sessionOf(ctxA("owner"));
    for (const id of ["../../etc/passwd", "zzzzzzzzzzzzzzz", ""]) {
      const res = await call(id);
      expect(res.status).toBe(404);
      expect(await res.text()).toContain(ERR_DOWNLOAD);
    }
  });

  it("no session redirects to /sign-in", async (t) => {
    if (!inst) return t.skip();
    state.session = null;
    const res = await call(signatureId);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/sign-in");
  });

  it("an owner with outdated terms can still download (gate exempt)", async (t) => {
    if (!inst) return t.skip();
    __setPolicySetForTests(withTosV2());
    try {
      state.session = sessionOf(ctxA("owner"));
      const res = await call(signatureId);
      expect(res.status).toBe(200);
      expect(sha(new Uint8Array(await res.arrayBuffer()))).toBe(documentSha);
    } finally {
      __setPolicySetForTests(null);
    }
  });

  it("a missing stored object is ERR-DOWNLOAD (404), no storage error", async (t) => {
    if (!inst) return t.skip();
    const html = files(storageDir).filter(
      (f) => f.includes(signatureId) && f.endsWith(".html"),
    );
    expect(html).toHaveLength(1);
    rmSync(html[0]!, { force: true });
    state.session = sessionOf(ctxA("owner"));
    const res = await call(signatureId);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain(ERR_DOWNLOAD);
    expect(body).not.toMatch(/ENOENT|tenants\//);
  });
});
