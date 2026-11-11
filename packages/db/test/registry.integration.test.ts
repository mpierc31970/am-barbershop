// Registry completeness on the live schema (TEN-01, TEN-03, LIFE-03; D187). Boots its own PB
// WITHOUT the test_widgets fixture: every non-system collection with an `organization` field
// must be declared in the composed registry (core + add-on collections) and vice versa, so a new tenant collection cannot
// escape the TEN-03 isolation suite (release gate) or the snapshot field lists.
// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import type { CollectionModel } from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  allTenantCollections,
  ORGANIZATION_EXPORT_FIELDS,
  type CollectionSpec,
} from "../src/registry";
import { bootPb, type PbInstance } from "./pb-harness";

const REGISTRY: Readonly<Record<string, CollectionSpec>> =
  allTenantCollections();

let inst: PbInstance | null = null;
let collections: CollectionModel[] = [];

function fieldNames(c: CollectionModel): string[] {
  return c.fields.map((f) => f.name);
}

// Legal evidence (09-03, registered 09-06) keeps a plain-text organization id so deleting
// an org or user never touches a row (RESEARCH Pitfall 5). P10 payment records (10-04)
// outlive the org the same way (BILL-09, D214). Every other collection relates.
const PLAIN_TEXT_ORG = new Set([
  "agreement_signatures",
  "site_policy_acks",
  "billing_invoices",
  "work_orders",
]);

function orgField(c: CollectionModel) {
  return c.fields.find((f) => f.name === "organization");
}

describe("tenant registry matches the live schema", () => {
  beforeAll(async () => {
    inst = await bootPb();
    if (!inst) return;
    resetClientForTests();
    const pb = await superuser();
    collections = (await pb.collections.getFullList()).filter(
      (c) => !c.name.startsWith("_"),
    );
  });

  afterAll(async () => {
    await inst?.stop();
  });

  it("every collection with an organization field is registered", (ctx) => {
    if (!inst) return ctx.skip();
    const withOrg = collections
      .filter((c) => orgField(c))
      .map((c) => c.name)
      .sort();
    expect(withOrg).toEqual(Object.keys(REGISTRY).sort());
  });

  it("every registry key exists with a relation to organizations (or a plain-text id)", (ctx) => {
    if (!inst) return ctx.skip();
    const orgs = collections.find((c) => c.name === "organizations");
    expect(orgs).toBeDefined();
    for (const name of Object.keys(REGISTRY)) {
      const c = collections.find((x) => x.name === name);
      expect(c, name).toBeDefined();
      const f = orgField(c!);
      if (PLAIN_TEXT_ORG.has(name)) {
        expect(f?.type, name).toBe("text");
        expect((f as { pattern?: string } | undefined)?.pattern, name).toBe(
          "^[a-z0-9]{15}$",
        );
        continue;
      }
      expect(f?.type, name).toBe("relation");
      expect(f?.collectionId, name).toBe(orgs!.id);
    }
  });

  it("organization is required unless organizationOptional", (ctx) => {
    if (!inst) return ctx.skip();
    for (const [name, spec] of Object.entries(REGISTRY)) {
      const c = collections.find((x) => x.name === name)!;
      expect(Boolean(orgField(c)?.required), name).toBe(
        !spec.organizationOptional,
      );
    }
  });

  it("registry kind matches the collection type", (ctx) => {
    if (!inst) return ctx.skip();
    for (const [name, spec] of Object.entries(REGISTRY)) {
      const c = collections.find((x) => x.name === name)!;
      expect(c.type === "auth", name).toBe(spec.kind === "auth");
    }
  });

  it("every export field exists in the live collection", (ctx) => {
    if (!inst) return ctx.skip();
    for (const [name, spec] of Object.entries(REGISTRY)) {
      if (spec.export === "never") continue;
      const live = fieldNames(collections.find((x) => x.name === name)!);
      const missing = spec.export.filter((f) => !live.includes(f));
      expect(missing, name).toEqual([]);
    }
    const orgs = fieldNames(
      collections.find((c) => c.name === "organizations")!,
    );
    expect(ORGANIZATION_EXPORT_FIELDS.filter((f) => !orgs.includes(f))).toEqual(
      [],
    );
  });

  it("org_addons has one row per (organization, addon) and null API rules", (ctx) => {
    if (!inst) return ctx.skip();
    const c = collections.find((x) => x.name === "org_addons")!;
    expect(c.indexes).toContain(
      "CREATE UNIQUE INDEX idx_org_addons_org_addon ON org_addons (organization, addon)",
    );
    for (const rule of [
      c.listRule,
      c.viewRule,
      c.createRule,
      c.updateRule,
      c.deleteRule,
    ]) {
      expect(rule).toBeNull();
    }
  });

  it("raises the batch limit for 2,000-row imports (RESEARCH Pitfall 3)", async (ctx) => {
    if (!inst) return ctx.skip();
    const pb = await superuser();
    const settings = (await pb.settings.getAll()) as {
      batch: { enabled: boolean; maxRequests: number; timeout: number };
    };
    expect(settings.batch).toMatchObject({
      enabled: true,
      maxRequests: 5000,
      timeout: 60,
    });
  });

  it("every ownerField exists in the live collection", (ctx) => {
    if (!inst) return ctx.skip();
    for (const [name, spec] of Object.entries(REGISTRY)) {
      if (!spec.ownerField) continue;
      const live = fieldNames(collections.find((x) => x.name === name)!);
      expect(live, name).toContain(spec.ownerField);
    }
  });
});
