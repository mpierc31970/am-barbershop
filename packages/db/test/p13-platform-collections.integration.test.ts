// 13-03 (STAFF-06, STAFF-07, STAFF-09, STAFF-17, STAFF-24; P13-P5, P13-P6): the five P13
// platform collections exist with every API rule null, canned_replies ships its 8 starters,
// the unique indexes hold, and no tenant repository can be built over any of them
// (T-13-03-03, invariant 1).
// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import { InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { tenantRepo } from "../src/repository";
import { bootPb, type PbInstance } from "./pb-harness";

const PLATFORM = [
  "staff_sessions",
  "canned_replies",
  "addon_listings",
  "review_cases",
  "org_indexing",
] as const;

const RULES = [
  "listRule",
  "viewRule",
  "createRule",
  "updateRule",
  "deleteRule",
] as const;

let inst: PbInstance | null = null;
let pb: PocketBase;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

describe("P13 platform collections (13-03)", () => {
  it("exist with every API rule null and no organization relation", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const name of PLATFORM) {
      const c = await pb.collections.getOne(name);
      for (const rule of RULES) expect(c[rule], `${name}.${rule}`).toBeNull();
      const fields = c.fields.map((f) => f.name);
      expect(fields, name).not.toContain("organization");
      expect(fields, name).not.toContain("key");
      expect(fields, name).not.toContain("token");
    }
  });

  it("seeds 8 canned replies, none archived, placeholders from the allowed set only", async (ctx) => {
    if (!inst) return ctx.skip();
    const rows = await pb.collection("canned_replies").getFullList();
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.title).sort()).toEqual(
      [
        "Billing hand-off",
        "Closing the ticket",
        "Fixed, please confirm",
        "How-to link",
        "Known problem",
        "Need more detail",
        "Paid service explained",
        "Welcome",
      ].sort(),
    );
    for (const r of rows) {
      expect(r.archived_at).toBe("");
      expect(r.created_by).toBe("");
      const tokens = String(r.body).match(/\{[^}]*\}/g) ?? [];
      for (const t of tokens) {
        expect(["{first_name}", "{business}", "{ticket}", "{agent}"]).toContain(
          t,
        );
      }
    }
  });

  it("enforces the unique keys (token_hash, slug, seq, org_id)", async (ctx) => {
    if (!inst) return ctx.skip();
    const hash = "a".repeat(64);
    await pb
      .collection("staff_sessions")
      .create({ token_hash: hash, user: "staffuser00001" });
    await expect(
      pb
        .collection("staff_sessions")
        .create({ token_hash: hash, user: "staffuser00002" }),
    ).rejects.toThrow();

    await pb.collection("addon_listings").create({ slug: "booking" });
    await expect(
      pb.collection("addon_listings").create({ slug: "booking" }),
    ).rejects.toThrow();

    await pb
      .collection("review_cases")
      .create({ seq: 1, kind: "report", status: "open" });
    await expect(
      pb
        .collection("review_cases")
        .create({ seq: 1, kind: "dmca", status: "open" }),
    ).rejects.toThrow();

    await pb.collection("org_indexing").create({ org_id: "org000000000001" });
    await expect(
      pb.collection("org_indexing").create({ org_id: "org000000000001" }),
    ).rejects.toThrow();
  });

  it("no tenant repository can be built over a platform collection", () => {
    for (const name of PLATFORM) {
      expect(() => tenantRepo(name), name).toThrow(InvalidInput);
    }
  });
});
