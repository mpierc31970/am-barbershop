// 09-03: the append-only legal collections on the real PocketBase 0.39.11 binary
// (AGR-01, AGR-05, AGR-08, D283; CONTEXT A1-Q2, A2-Q2, A5-Q3; RESEARCH Pattern 3).
// Writes go through the superuser client on purpose: superuser saves bypass API rules, so
// only the model hooks in pb_hooks/legal_append_only.pb.js stand between them and a row.
// This is the DB-level guard test, so direct PB access inside packages/db/test is allowed.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;

beforeAll(async () => {
  inst = await bootPb();
  resetClientForTests();
}, 120_000);

afterAll(async () => {
  await inst?.stop();
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const pbId = () => randomBytes(8).toString("hex").slice(0, 15);
const MINUTE = 60_000;
const YEAR = 365 * 24 * 60 * MINUTE;

function pbDate(d: Date): string {
  return d.toISOString().replace("T", " ");
}

async function rejects(p: Promise<unknown>): Promise<number> {
  try {
    await p;
  } catch (err) {
    return (err as { status?: number }).status ?? -1;
  }
  return 0;
}

async function policy(over: Record<string, unknown> = {}) {
  const pb = await superuser();
  const body = "# Terms\n\n" + "Clause text. ".repeat(600);
  return pb.collection("policy_versions").create({
    key: `terms-${randomBytes(3).toString("hex")}`,
    version: 1,
    title: "Terms of Service",
    summary: ["You own your content."],
    changes: "First version",
    body_md: body,
    sha256: sha(body),
    effective_at: pbDate(new Date()),
    status: "active",
    draft: true,
    ...over,
  });
}

async function signature(retainUntil: Date, signer = pbId()) {
  const pb = await superuser();
  return pb.collection("agreement_signatures").create({
    organization: pbId(),
    signer,
    signer_email: `signer-${randomBytes(3).toString("hex")}@example.com`,
    signer_name: "Pat Owner",
    org_name: "Pat's Studio",
    policies: [{ key: "terms", version: 1 }],
    consent: { checked: true },
    ip: "203.0.113.9",
    user_agent: "vitest",
    auth_method: "otp",
    signed_at: pbDate(new Date()),
    order_snapshot: { lines: [] },
    document_key: "tenants/x/agreements/a.pdf",
    document_sha256: sha("doc"),
    evidence_sha256: sha("evidence"),
    retain_until: pbDate(retainUntil),
    kind: "signup",
  });
}

async function ack(retainUntil: Date, kind: "ack" | "review" = "ack") {
  const pb = await superuser();
  return pb.collection("site_policy_acks").create({
    organization: pbId(),
    user: pbId(),
    user_name: "Pat Owner",
    kind,
    template_version: 1,
    privacy_sha256: sha("privacy"),
    terms_sha256: sha("terms"),
    clause_ids: ["booking"],
    ip: "203.0.113.9",
    acked_at: pbDate(new Date()),
    retain_until: pbDate(retainUntil),
  });
}

describe("policy_versions are immutable (CONTEXT A1-Q2)", () => {
  it("stores a long body (over 5000 characters) uncut", async (ctx) => {
    if (!inst) return ctx.skip();
    const row = await policy();
    expect((row.body_md as string).length).toBeGreaterThan(5000);
  });

  it("refuses edits to every content field", async (ctx) => {
    if (!inst) return ctx.skip();
    const pb = await superuser();
    const row = await policy();
    const edits: Record<string, unknown>[] = [
      { body_md: "changed" },
      { sha256: sha("changed") },
      { title: "Changed" },
      { summary: ["changed"] },
      { version: 2 },
      { key: "changed-key" },
    ];
    for (const edit of edits) {
      expect(
        await rejects(pb.collection("policy_versions").update(row.id, edit)),
      ).toBe(400);
    }
    const stored = await pb.collection("policy_versions").getOne(row.id);
    expect(stored.body_md).toBe(row.body_md);
    expect(stored.version).toBe(1);
  });

  it("allows active -> retired only, and never a delete", async (ctx) => {
    if (!inst) return ctx.skip();
    const pb = await superuser();
    const row = await policy();
    const retired = await pb
      .collection("policy_versions")
      .update(row.id, { status: "retired" });
    expect(retired.status).toBe("retired");
    expect(
      await rejects(
        pb.collection("policy_versions").update(row.id, { status: "active" }),
      ),
    ).toBe(400);
    expect(await rejects(pb.collection("policy_versions").delete(row.id))).toBe(
      400,
    );
    expect((await pb.collection("policy_versions").getOne(row.id)).status).toBe(
      "retired",
    );
  });

  it("refuses a duplicate (key, version)", async (ctx) => {
    if (!inst) return ctx.skip();
    const row = await policy();
    expect(await rejects(policy({ key: row.key }))).toBe(400);
  });
});

for (const [name, make] of [
  ["agreement_signatures", (d: Date) => signature(d)],
  ["site_policy_acks", (d: Date) => ack(d)],
] as const) {
  describe(`${name} is append-only (D283)`, () => {
    it("refuses any update and an early delete", async (ctx) => {
      if (!inst) return ctx.skip();
      const pb = await superuser();
      const row = await make(new Date(Date.now() + 7 * YEAR));
      expect(
        await rejects(
          pb.collection(name).update(row.id, { ip: "198.51.100.1" }),
        ),
      ).toBe(400);
      expect(await rejects(pb.collection(name).delete(row.id))).toBe(400);
      expect((await pb.collection(name).getOne(row.id)).ip).toBe("203.0.113.9");
    });

    it("allows delete once retain_until has passed, still refuses update", async (ctx) => {
      if (!inst) return ctx.skip();
      const pb = await superuser();
      const row = await make(new Date(Date.now() - MINUTE));
      expect(
        await rejects(
          pb.collection(name).update(row.id, { ip: "198.51.100.1" }),
        ),
      ).toBe(400);
      expect(await rejects(pb.collection(name).delete(row.id))).toBe(0);
      expect(await rejects(pb.collection(name).getOne(row.id))).toBe(404);
    });
  });
}

describe("site_policy_acks review rows", () => {
  it("accepts kind review", async (ctx) => {
    if (!inst) return ctx.skip();
    const row = await ack(new Date(Date.now() + YEAR), "review");
    expect(row.kind).toBe("review");
  });
});

describe("plain-text ids (RESEARCH Pitfall 5)", () => {
  it("deleting the signer user leaves the signature row unchanged", async (ctx) => {
    if (!inst) return ctx.skip();
    const pb = await superuser();
    const password = `pw-${randomBytes(8).toString("hex")}`;
    const user = await pb.collection("users").create({
      email: `legal-${randomBytes(4).toString("hex")}@example.com`,
      password,
      passwordConfirm: password,
    });
    const sig = await signature(new Date(Date.now() + 7 * YEAR), user.id);
    await pb.collection("users").delete(user.id);
    const stored = await pb.collection("agreement_signatures").getOne(sig.id);
    expect(stored.signer).toBe(user.id);
    expect(stored.evidence_sha256).toBe(sig.evidence_sha256);
  });
});
