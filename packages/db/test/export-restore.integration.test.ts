// TEN-10 / TEN-12 / TEN-13 / LIFE-03 tenant export and isolated restore on the real
// PocketBase 0.39.11 binary (RESEARCH Pattern 8, D187). Exports are JSON bundles in the
// ObjectStore built only through toSnapshot; a restore replaces one org's records in one
// PB batch, never touches another org, keeps audit history, and refuses tampered bundles.
// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Forbidden,
  InvalidContext,
  NotFound,
  RestoreRejected,
} from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  mintPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import {
  exportTenant,
  pruneExports,
  restoreTenant,
  runNightlyExports,
  type TenantBundle,
} from "../src/export";
import { allTenantCollections } from "../src/registry";
import { toSnapshot } from "../src/snapshot";
import { LocalDiskStore } from "../src/storage/local-disk";
import { tenantExportKey } from "../src/storage/keys";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
const PLANTED_PASSWORD = "PLANTED-pw-never-exported-7f3a9c";
const PLANTED_PAGE_HASH = "PLANTED-page-hash-never-exported-41d2";
const DAY = 24 * 60 * 60 * 1000;

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let root: string;
let store: LocalDiskStore;
let superCtx: PlatformContext;
let agentCtx: PlatformContext;
let adminCtxA: OrgContext;
let savedEnv: string | undefined;

const EXPORTABLE = Object.entries(allTenantCollections())
  .filter(([, spec]) => spec.export !== "never")
  .map(([name]) => name);

async function newUser(
  email: string,
  password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  staffRole = "",
): Promise<string> {
  return (
    await pb.collection("users").create({
      email,
      password,
      passwordConfirm: password,
      staff_role: staffRole,
    })
  ).id;
}

function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  delete out.created;
  delete out.updated;
  return out;
}

/** Every exportable collection + the org record of one org, via the superuser client. */
async function dump(orgId: string, withAudit = true) {
  const org = await pb.collection("organizations").getOne(orgId);
  const out: Record<string, unknown> = {
    organization: toSnapshot("organizations", org),
  };
  for (const name of EXPORTABLE) {
    if (!withAudit && name === "audit_log") continue;
    const rows = await pb.collection(name).getFullList({
      filter: pb.filter("organization = {:org}", { org: orgId }),
      sort: "id",
    });
    out[name] = rows.map((r) => toSnapshot(name, r));
  }
  return out;
}

async function load(key: string): Promise<TenantBundle> {
  const bytes = await store.get(key);
  expect(bytes).not.toBeNull();
  return JSON.parse(new TextDecoder().decode(bytes!)) as TenantBundle;
}

async function freshBundle(): Promise<TenantBundle> {
  const { key } = await exportTenant(superCtx, seed.A.org, { store });
  return load(key);
}

/** The two legal evidence skips every restore reports (AGR-05, Pitfall 2). */
const EVIDENCE = "append-only evidence";
function withoutEvidence<T extends { reason: string }>(skipped: T[]): T[] {
  return skipped.filter((s) => s.reason !== EVIDENCE);
}

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const RETAIN = "2033-10-08 00:00:00.000Z";

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

beforeAll(async () => {
  savedEnv = process.env.CDS_ENV;
  delete process.env.CDS_ENV;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  root = mkdtempSync(join(tmpdir(), "cds-export-"));
  store = new LocalDiskStore(root);

  // A page password hash in org A: hidden, never exported (T-03-08).
  await pb.collection("pages").update(seed.A.page, {
    password_hash: PLANTED_PAGE_HASH,
    password_protected: true,
  });
  // A user with a known password in org A: it must never reach a bundle.
  const planted = await newUser("planted@cds.test", PLANTED_PASSWORD);
  await pb
    .collection("memberships")
    .create({ user: planted, organization: seed.A.org, role: "editor" });
  await pb.collection("org_hosts").create({
    hostname: "a-preview.example.com",
    organization: seed.A.org,
    kind: "preview",
    primary: false,
  });
  const admin = await newUser("admin-a@cds.test");
  await pb
    .collection("memberships")
    .create({ user: admin, organization: seed.A.org, role: "admin" });
  adminCtxA = mintOrgContext({
    orgId: seed.A.org,
    actor: admin,
    role: "admin",
    grants: [],
    ip: IP,
  });
  const s = await newUser("super@cds.test", undefined, "super_admin");
  const t = await newUser("agent@cds.test", undefined, "support_agent");
  superCtx = mintPlatformContext({
    actor: s,
    staffRole: "super_admin",
    ip: IP,
  });
  agentCtx = mintPlatformContext({
    actor: t,
    staffRole: "support_agent",
    ip: IP,
  });
});

afterAll(async () => {
  await inst?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.CDS_ENV;
  else process.env.CDS_ENV = savedEnv;
});

describe("TEN-10 / TEN-13 export", () => {
  it("owner export writes an allow-listed bundle under dev/tenants/<org>/exports/", async (t) => {
    if (!inst) return t.skip();
    const { key, counts } = await exportTenant(seed.ctxA, seed.A.org, {
      store,
    });
    expect(key).toMatch(
      new RegExp(`^dev/tenants/${seed.A.org}/exports/[0-9TZ-]+\\.json$`),
    );
    const raw = new TextDecoder().decode((await store.get(key))!);
    const bundle = JSON.parse(raw) as TenantBundle;
    expect(bundle.format).toBe("cds-tenant-export");
    expect(bundle.version).toBe(1);
    expect(bundle.orgId).toBe(seed.A.org);
    expect(bundle.organization.id).toBe(seed.A.org);
    expect(bundle.organization.name).toBe("Org A");
    expect(Object.keys(bundle.collections).sort()).toEqual(
      [...EXPORTABLE].sort(),
    );
    expect(bundle.collections).not.toHaveProperty("end_users");
    expect(bundle.collections.memberships!.length).toBe(counts.memberships);
    expect(counts.org_hosts).toBe(2);
    for (const rows of Object.values(bundle.collections)) {
      for (const r of rows) expect(r.organization).toBe(seed.A.org);
    }
    // LIFE-03 / TEN-13: no secret, no end user, no other org.
    expect(raw).not.toContain(PLANTED_PASSWORD);
    expect(raw).not.toContain("customer-a@cds.test");
    expect(raw).not.toContain(seed.B.org);
    // pages.password_protected (a boolean) is the only password-named key allowed (T-03-08).
    expect(raw).not.toContain(PLANTED_PAGE_HASH);
    expect(raw.replaceAll('"password_protected"', "")).not.toMatch(
      /password|tokenKey/i,
    );
  });

  it("an owner cannot export another org (NotFound); an admin is Forbidden", async (t) => {
    if (!inst) return t.skip();
    await expect(
      exportTenant(seed.ctxA, seed.B.org, { store }),
    ).rejects.toThrow(NotFound);
    await expect(
      exportTenant(adminCtxA, seed.A.org, { store }),
    ).rejects.toThrow(Forbidden);
  });

  it("a support agent may export, and the export is audited", async (t) => {
    if (!inst) return t.skip();
    const { key } = await exportTenant(agentCtx, seed.B.org, { store });
    expect(key).toContain(`tenants/${seed.B.org}/exports/`);
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:org} && action = 'tenant.export' && actor = {:a}",
        { org: seed.B.org, a: agentCtx.actor },
      ),
    });
    expect(rows).toHaveLength(1);
    await expect(
      exportTenant(agentCtx, "nosuchorg000000", { store }),
    ).rejects.toThrow(NotFound);
  });
});

describe("TEN-12 isolated restore", () => {
  it("restores A exactly (ids preserved, extra rows removed) and leaves B deep-equal", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const bBefore = await dump(seed.B.org);
    const auditBefore = (
      await pb.collection("audit_log").getFullList({
        filter: pb.filter("organization = {:org}", { org: seed.A.org }),
      })
    ).map((r) => r.id);

    // Mutate A.
    await pb.collection("org_hosts").delete(seed.A.host);
    await pb.collection("org_hosts").create({
      hostname: "a-extra.example.com",
      organization: seed.A.org,
      kind: "custom",
      primary: false,
    });
    const editor = bundle.collections.memberships!.find(
      (m) => m.role === "editor",
    )!;
    await pb
      .collection("memberships")
      .update(editor.id as string, { role: "viewer" });
    await pb.collection("organizations").update(seed.A.org, {
      name: "Renamed A",
    });
    // An audit row lost from A: append-missing brings it back with the same id.
    await pb.collection("audit_log").delete(seed.A.audit);

    const res = await restoreTenant(superCtx, bundle);
    expect(res.restored.org_hosts).toBe(2);
    expect(withoutEvidence(res.skipped)).toEqual([]);

    const after = await dump(seed.A.org);
    expect((after.organization as Record<string, unknown>).name).toBe("Org A");
    for (const name of ["memberships", "org_hosts"]) {
      expect((after[name] as Record<string, unknown>[]).map(strip)).toEqual(
        bundle.collections[name]!.map(strip),
      );
    }
    const auditAfter = (after.audit_log as Record<string, unknown>[]).map(
      (r) => r.id,
    );
    for (const id of auditBefore) expect(auditAfter).toContain(id);
    const restoreRows = (after.audit_log as Record<string, unknown>[]).filter(
      (r) => r.action === "tenant.restore",
    );
    expect(restoreRows).toHaveLength(1);
    expect(restoreRows[0]!.actor).toBe(superCtx.actor);

    expect(await dump(seed.B.org)).toEqual(bBefore);
  });

  it("rejects a bundle naming another org's record before any write", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    await pb
      .collection("organizations")
      .update(seed.A.org, { name: "Changed A" });
    const aBefore = await dump(seed.A.org);
    const bBefore = await dump(seed.B.org);
    const tampered = structuredClone(bundle);
    tampered.collections.org_hosts![0]!.organization = seed.B.org;
    await expect(restoreTenant(superCtx, tampered)).rejects.toThrow(
      RestoreRejected,
    );
    expect(await dump(seed.A.org)).toEqual(aBefore);
    expect(await dump(seed.B.org)).toEqual(bBefore);
  });

  it("rejects a bundle that would take over another org's record id", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const bBefore = await dump(seed.B.org);
    const hijack = structuredClone(bundle);
    hijack.collections.org_hosts![0]!.id = seed.B.host;
    await expect(restoreTenant(superCtx, hijack)).rejects.toThrow(
      RestoreRejected,
    );
    expect(await dump(seed.B.org)).toEqual(bBefore);
  });

  it("rejects malformed bundles (format, unknown or never-exported collection, bad id)", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const cases: unknown[] = [
      null,
      { ...bundle, format: "other" },
      { ...bundle, version: 2 },
      { ...bundle, collections: { ...bundle.collections, users: [] } },
      { ...bundle, collections: { ...bundle.collections, end_users: [] } },
      {
        ...bundle,
        collections: {
          ...bundle.collections,
          org_hosts: [{ ...bundle.collections.org_hosts![0], id: "../x" }],
        },
      },
      { ...bundle, organization: { ...bundle.organization, id: seed.B.org } },
    ];
    for (const c of cases) {
      await expect(restoreTenant(superCtx, c)).rejects.toThrow(RestoreRejected);
    }
  });

  it("skips a membership whose user no longer exists and restores the rest", async (t) => {
    if (!inst) return t.skip();
    const gone = await newUser("gone@cds.test");
    const m = await pb
      .collection("memberships")
      .create({ user: gone, organization: seed.A.org, role: "viewer" });
    const bundle = await freshBundle();
    await pb.collection("memberships").delete(m.id);
    await pb.collection("users").delete(gone);
    const res = await restoreTenant(superCtx, bundle);
    expect(withoutEvidence(res.skipped)).toEqual([
      { collection: "memberships", id: m.id, reason: "user no longer exists" },
    ]);
    expect(res.restored.memberships).toBe(
      bundle.collections.memberships!.length - 1,
    );
    await expect(pb.collection("memberships").getOne(m.id)).rejects.toThrow();
  });

  it("skips a membership whose user has since become CDS staff (CR-03)", async (t) => {
    if (!inst) return t.skip();
    const later = await newUser("later-staff@cds.test");
    const m = await pb
      .collection("memberships")
      .create({ user: later, organization: seed.A.org, role: "admin" });
    const bundle = await freshBundle();
    await pb.collection("memberships").delete(m.id);
    await pb.collection("users").update(later, { staff_role: "support_agent" });
    const res = await restoreTenant(superCtx, bundle);
    expect(withoutEvidence(res.skipped)).toEqual([
      { collection: "memberships", id: m.id, reason: "user is CDS staff" },
    ]);
    await expect(pb.collection("memberships").getOne(m.id)).rejects.toThrow();
  });

  it("marks a restored audit row with its original time and source (WR-03)", async (t) => {
    if (!inst) return t.skip();
    const lost = await pb.collection("audit_log").create({
      organization: seed.A.org,
      actor: seed.A.owner,
      action: "fixture.lost",
      ip: IP,
      meta: { note: "kept" },
    });
    const bundle = await freshBundle();
    const inBundle = bundle.collections.audit_log!.find(
      (r) => r.id === lost.id,
    )!;
    await pb.collection("audit_log").delete(lost.id);
    await restoreTenant(superCtx, bundle);
    const back = await pb.collection("audit_log").getOne(lost.id);
    expect(back.meta).toEqual({
      note: "kept",
      original_created: inBundle.created,
      restored_from: bundle.createdAt,
    });
    expect(inBundle.created).toBeTruthy();
  });

  it("keeps the current org status unless restoreStatus is set (WR-02)", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    expect(bundle.organization.status).toBe("active");
    await pb.collection("organizations").update(seed.A.org, { status: "held" });
    try {
      await restoreTenant(superCtx, bundle);
      expect(
        (await pb.collection("organizations").getOne(seed.A.org)).status,
      ).toBe("held");
      await restoreTenant(superCtx, bundle, { restoreStatus: true });
      expect(
        (await pb.collection("organizations").getOne(seed.A.org)).status,
      ).toBe("active");
    } finally {
      await pb
        .collection("organizations")
        .update(seed.A.org, { status: "active" });
    }
  });

  it("rejects a bundle that would leave the org without an owner (WR-02)", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const aBefore = await dump(seed.A.org);
    const noOwner = structuredClone(bundle);
    noOwner.collections.memberships = noOwner.collections.memberships!.filter(
      (m) => m.role !== "owner",
    );
    const err = await catchErr(restoreTenant(superCtx, noOwner));
    expect(err).toBeInstanceOf(RestoreRejected);
    expect((err as Error).message).toMatch(/no owner/);
    expect(await dump(seed.A.org)).toEqual(aBefore);
  });

  it("rejects an owner who now owns another organization (WR-02, D286)", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const ownerRow = (
      await pb.collection("memberships").getFirstListItem(
        pb.filter("organization = {:org} && role = 'owner'", {
          org: seed.A.org,
        }),
      )
    ).id;
    const newOwner = await newUser("new-owner-a@cds.test");
    const orgC = (
      await pb
        .collection("organizations")
        .create({ name: "Org C", slug: "org-c-restore", status: "active" })
    ).id;
    await pb.collection("memberships").update(ownerRow, { role: "admin" });
    const newOwnerRow = (
      await pb
        .collection("memberships")
        .create({ user: newOwner, organization: seed.A.org, role: "owner" })
    ).id;
    const cRow = (
      await pb
        .collection("memberships")
        .create({ user: seed.A.owner, organization: orgC, role: "owner" })
    ).id;
    try {
      const err = await catchErr(restoreTenant(superCtx, bundle));
      expect(err).toBeInstanceOf(RestoreRejected);
      expect((err as Error).message).toMatch(/owns another organization/);
    } finally {
      await pb.collection("memberships").delete(cRow);
      await pb.collection("organizations").delete(orgC);
      await pb.collection("memberships").delete(newOwnerRow);
      await pb.collection("memberships").update(ownerRow, { role: "owner" });
      await pb.collection("users").delete(newOwner);
    }
  });

  it("rejects org_hosts rows that are not tenant hosts (WR-02, D4)", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    for (const hostname of ["127.0.0.1", "not a host", "localhost", 42]) {
      const bad = structuredClone(bundle);
      (bad.collections.org_hosts![0] as Record<string, unknown>).hostname =
        hostname;
      await expect(restoreTenant(superCtx, bad)).rejects.toThrow(
        RestoreRejected,
      );
    }
  });

  it("rolls the whole restore back when one request fails", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    await pb
      .collection("organizations")
      .update(seed.A.org, { name: "Mid-batch A" });
    const aBefore = await dump(seed.A.org);
    const bBefore = await dump(seed.B.org);
    const bad = structuredClone(bundle);
    bad.collections.org_hosts![1]!.hostname = "b.example.com"; // B's host
    await expect(restoreTenant(superCtx, bad)).rejects.toThrow(RestoreRejected);
    expect(await dump(seed.A.org)).toEqual(aBefore);
    expect(await dump(seed.B.org)).toEqual(bBefore);
  });

  it("refuses a bundle over the 1000-request batch cap, never chunks", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const aBefore = await dump(seed.A.org);
    const big = structuredClone(bundle);
    big.collections.org_hosts = Array.from({ length: 1001 }, (_, i) => ({
      id: `h${String(i).padStart(14, "0")}`,
      hostname: `h${i}.example.com`,
      organization: seed.A.org,
      kind: "custom",
      primary: false,
      created: null,
      updated: null,
    }));
    const err = await catchErr(restoreTenant(superCtx, big));
    expect(err).toBeInstanceOf(RestoreRejected);
    expect((err as Error).message).toMatch(/too large/);
    expect(await dump(seed.A.org)).toEqual(aBefore);
  });

  // RESEARCH Pitfall 4 / TEN-12: page_sections.page is a required relation. Deletes run in
  // reverse registry order (sections before pages), then upserts forward.
  it("removes pages and sections added after the export and restores the originals", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const bBefore = await dump(seed.B.org);
    const extraPage = (
      await pb.collection("pages").create({
        organization: seed.A.org,
        slug: "extra",
        title: "Extra",
        status: "draft",
        kind: "builder",
      })
    ).id;
    const extraSection = (
      await pb.collection("page_sections").create({
        organization: seed.A.org,
        page: extraPage,
        section_type: "text-only",
        row_layout: "full",
        sort_order: 1,
      })
    ).id;
    await pb.collection("pages").update(seed.A.page, { title: "Edited" });

    await restoreTenant(superCtx, bundle);

    const after = await dump(seed.A.org);
    for (const name of ["pages", "page_sections"]) {
      expect((after[name] as Record<string, unknown>[]).map(strip)).toEqual(
        bundle.collections[name]!.map(strip),
      );
    }
    const pageIds = (after.pages as Record<string, unknown>[]).map((r) => r.id);
    expect(pageIds).not.toContain(extraPage);
    expect(
      (after.page_sections as Record<string, unknown>[]).map((r) => r.id),
    ).not.toContain(extraSection);
    expect(await dump(seed.B.org)).toEqual(bBefore);
  });

  it("drops a page and its sections when the bundle has neither (no relation failure)", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const bBefore = await dump(seed.B.org);
    const dropped = structuredClone(bundle);
    dropped.collections.pages = dropped.collections.pages!.filter(
      (p) => p.id !== seed.A.page,
    );
    dropped.collections.page_sections =
      dropped.collections.page_sections!.filter((s) => s.page !== seed.A.page);
    // P7 (07-01): a form message keeps an optional link to its page. A consistent bundle
    // without the page has that link unset (PB unsets an optional relation on delete).
    for (const s of dropped.collections.form_submissions ?? []) {
      if (s.page === seed.A.page) s.page = "";
    }
    await restoreTenant(superCtx, dropped);
    const after = await dump(seed.A.org);
    expect(
      (after.pages as Record<string, unknown>[]).map((r) => r.id),
    ).not.toContain(seed.A.page);
    expect(
      (after.page_sections as Record<string, unknown>[]).map((r) => r.page),
    ).not.toContain(seed.A.page);
    expect(await dump(seed.B.org)).toEqual(bBefore);
    // Put org A's content back for the tests that follow.
    await restoreTenant(superCtx, bundle);
  });

  it("rejects a section that points at another org's page or a page not restored", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    await pb
      .collection("organizations")
      .update(seed.A.org, { name: "Section guard A" });
    const aBefore = await dump(seed.A.org);
    const bBefore = await dump(seed.B.org);
    const foreign = structuredClone(bundle);
    foreign.collections.page_sections![0]!.page = seed.B.page;
    const orphan = structuredClone(bundle);
    orphan.collections.pages = [];
    for (const bad of [foreign, orphan]) {
      await expect(restoreTenant(superCtx, bad)).rejects.toThrow(
        RestoreRejected,
      );
    }
    expect(await dump(seed.A.org)).toEqual(aBefore);
    expect(await dump(seed.B.org)).toEqual(bBefore);
  });

  it("rejects any relation that points at another org's record (07-15, deferred from 07-01)", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const aBefore = await dump(seed.A.org);
    const bBefore = await dump(seed.B.org);
    const tamper: ((b: TenantBundle) => void)[] = [
      (b) => (b.collections.form_submissions![0]!.form = seed.B.form),
      (b) => (b.collections.form_submissions![0]!.page = seed.B.page),
      (b) => (b.collections.form_submissions![0]!.contact = seed.B.contact),
      (b) => (b.collections.contact_list_members![0]!.contact = seed.B.contact),
      (b) => (b.collections.contact_notes![0]!.list = seed.B.contactList),
      (b) => (b.collections.contact_events![0]!.contact = seed.B.contact),
    ];
    for (const fn of tamper) {
      const bad = structuredClone(bundle);
      fn(bad);
      const err = await catchErr(restoreTenant(superCtx, bad));
      expect(err).toBeInstanceOf(RestoreRejected);
      expect((err as Error).message).toMatch(/points at a record/);
    }
    // A relation to a row the bundle does not restore is refused too.
    const dropped = structuredClone(bundle);
    dropped.collections.forms = [];
    expect(await catchErr(restoreTenant(superCtx, dropped))).toBeInstanceOf(
      RestoreRejected,
    );
    expect(await dump(seed.A.org)).toEqual(aBefore);
    expect(await dump(seed.B.org)).toEqual(bBefore);
  });

  it("removes a contact gained after the export together with its events (CR-A01)", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const bBefore = await dump(seed.B.org);
    const late = (
      await pb.collection("contacts").create({
        organization: seed.A.org,
        email: "late@cds.test",
        email_norm: "late@cds.test",
        first_source: "form",
        marketing_consent: { status: "none" },
      })
    ).id;
    const lateEvent = (
      await pb.collection("contact_events").create({
        organization: seed.A.org,
        contact: late,
        kind: "form",
        summary: "Contact form",
        at: new Date().toISOString(),
      })
    ).id;
    await restoreTenant(superCtx, bundle);
    await expect(pb.collection("contacts").getOne(late)).rejects.toThrow();
    await expect(
      pb.collection("contact_events").getOne(lateEvent),
    ).rejects.toThrow();
    // Bundled history is untouched.
    await expect(
      pb.collection("contact_events").getOne(seed.A.contactEvent),
    ).resolves.toBeTruthy();
    expect(await dump(seed.B.org)).toEqual(bBefore);
  });

  it("removes a form gained after the export even while a visitor draft points at it (review CR-A01)", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    const bBefore = await dump(seed.B.org);
    const lateForm = (
      await pb.collection("forms").create({
        organization: seed.A.org,
        name: "Late form",
        template: "contact",
        layout: "1",
        fields: [],
        notify_route: "inquiries",
      })
    ).id;
    const draft = (
      await pb.collection("form_drafts").create({
        organization: seed.A.org,
        form: lateForm,
        email: "visitor@cds.test",
        data: {},
        token_hash: "c".repeat(64),
        expires_at: new Date(Date.now() + DAY).toISOString(),
      })
    ).id;
    await restoreTenant(superCtx, bundle);
    await expect(pb.collection("forms").getOne(lateForm)).rejects.toThrow();
    await expect(pb.collection("form_drafts").getOne(draft)).rejects.toThrow();
    expect(await dump(seed.B.org)).toEqual(bBefore);
  });

  it("clears a note author and a list owner whose user is gone instead of failing (WR-A01)", async (t) => {
    if (!inst) return t.skip();
    const renter = await newUser("renter-gone@cds.test");
    const renterRow = (
      await pb
        .collection("memberships")
        .create({ user: renter, organization: seed.A.org, role: "viewer" })
    ).id;
    const renterList = (
      await pb.collection("contact_lists").create({
        organization: seed.A.org,
        name: "Renter list",
        kind: "renter",
        owner_member: renterRow,
      })
    ).id;
    const writer = await newUser("note-writer-gone@cds.test");
    const note = (
      await pb.collection("contact_notes").create({
        organization: seed.A.org,
        contact: seed.A.contact,
        list: seed.A.contactList,
        body: "Written by a user who leaves",
        author: writer,
      })
    ).id;
    const bundle = await freshBundle();
    await pb.collection("memberships").delete(renterRow);
    await pb.collection("users").delete(renter);
    await pb.collection("users").delete(writer);
    try {
      const res = await restoreTenant(superCtx, bundle);
      expect(res.skipped).toContainEqual({
        collection: "memberships",
        id: renterRow,
        reason: "user no longer exists",
      });
      expect(
        (await pb.collection("contact_lists").getOne(renterList)).owner_member,
      ).toBe("");
      const back = await pb.collection("contact_notes").getOne(note);
      expect(back.author).toBe("");
      expect(back.body).toBe("Written by a user who leaves");
    } finally {
      await pb
        .collection("contact_notes")
        .delete(note)
        .catch(() => undefined);
      await pb
        .collection("contact_lists")
        .delete(renterList)
        .catch(() => undefined);
    }
  });

  it("restore is super_admin only; an org context is not a platform context", async (t) => {
    if (!inst) return t.skip();
    const bundle = await freshBundle();
    await expect(restoreTenant(agentCtx, bundle)).rejects.toThrow(Forbidden);
    await expect(
      restoreTenant(seed.ctxA as unknown as PlatformContext, bundle),
    ).rejects.toThrow(InvalidContext);
  });
});

describe("AGR-05 legal evidence survives restore (RESEARCH Pitfall 2, D187)", () => {
  it("restore never deletes nor forges a signature or an acknowledgement", async (t) => {
    if (!inst) return t.skip();
    const sig = await pb.collection("agreement_signatures").create({
      organization: seed.A.org,
      signer: seed.A.owner,
      signer_email: "owner-a@cds.test",
      signer_name: "Owner A",
      org_name: "Org A",
      policies: [{ key: "terms", version: 1, sha256: HEX_A }],
      consent: { version: 1, sha256: HEX_A },
      ip: IP,
      user_agent: "vitest",
      auth_method: "otp",
      signed_at: new Date().toISOString(),
      order_snapshot: { lines: [] },
      document_key: `dev/tenants/${seed.A.org}/agreements/x.pdf`,
      document_sha256: HEX_A,
      evidence_sha256: HEX_B,
      retain_until: RETAIN,
      kind: "signup",
    });
    const ack = await pb.collection("site_policy_acks").create({
      organization: seed.A.org,
      user: seed.A.owner,
      user_name: "Owner A",
      kind: "ack",
      template_version: 1,
      privacy_sha256: HEX_A,
      terms_sha256: HEX_B,
      clause_ids: ["core.contact"],
      ip: IP,
      acked_at: new Date().toISOString(),
      retain_until: RETAIN,
    });

    // The export carries the tenant's own evidence, exactly the approved fields.
    const bundle = await freshBundle();
    const exported = bundle.collections.agreement_signatures!.find(
      (r) => r.id === sig.id,
    )!;
    expect(Object.keys(exported).sort()).toEqual(
      [
        ...(allTenantCollections().agreement_signatures!.export as string[]),
      ].sort(),
    );
    expect(exported.signer_name).toBe("Owner A");
    expect(bundle.collections.site_policy_acks!.map((r) => r.id)).toContain(
      ack.id,
    );

    // A bundle that drops the real rows and forges one of each for org A.
    const forgedSig = "forgedsig000001";
    const forgedAck = "forgedack000001";
    bundle.collections.agreement_signatures = [
      { ...exported, id: forgedSig, signer_name: "Forged Signer" },
    ];
    bundle.collections.site_policy_acks = [
      {
        ...bundle.collections.site_policy_acks!.find((r) => r.id === ack.id)!,
        id: forgedAck,
      },
    ];
    const sigBefore = await pb
      .collection("agreement_signatures")
      .getOne(sig.id);
    const ackBefore = await pb.collection("site_policy_acks").getOne(ack.id);

    const res = await restoreTenant(superCtx, bundle);
    expect(res.skipped).toContainEqual({
      collection: "agreement_signatures",
      id: "",
      reason: EVIDENCE,
    });
    expect(res.skipped).toContainEqual({
      collection: "site_policy_acks",
      id: "",
      reason: EVIDENCE,
    });
    expect(res.restored).not.toHaveProperty("agreement_signatures");
    expect(res.restored.memberships).toBe(
      bundle.collections.memberships!.length,
    );

    expect(await pb.collection("agreement_signatures").getOne(sig.id)).toEqual(
      sigBefore,
    );
    expect(await pb.collection("site_policy_acks").getOne(ack.id)).toEqual(
      ackBefore,
    );
    await expect(
      pb.collection("agreement_signatures").getOne(forgedSig),
    ).rejects.toThrow();
    await expect(
      pb.collection("site_policy_acks").getOne(forgedAck),
    ).rejects.toThrow();
  });
});

describe("TEN-12 retention and the nightly job", () => {
  it("prunes only this org's exports older than 90 days", async (t) => {
    if (!inst) return t.skip();
    const now = new Date("2026-09-26T04:10:00.000Z");
    const old = tenantExportKey(seed.A.org, new Date(now.getTime() - 91 * DAY));
    const recent = tenantExportKey(
      seed.A.org,
      new Date(now.getTime() - 89 * DAY),
    );
    const otherOrg = tenantExportKey(
      seed.B.org,
      new Date(now.getTime() - 91 * DAY),
    );
    for (const k of [old, recent, otherOrg]) await store.put(k, "{}");
    const pruned = await pruneExports(store, seed.A.org, now);
    expect(pruned).toEqual([old]);
    expect(await store.get(old)).toBeNull();
    expect(await store.get(recent)).not.toBeNull();
    expect(await store.get(otherOrg)).not.toBeNull();
  });

  it("exports every organization (active, held, disabled) with one system audit row each", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("organizations").update(seed.B.org, { status: "held" });
    const c = await pb
      .collection("organizations")
      .create({ name: "Org C", slug: "org-c", status: "disabled" });
    const now = new Date("2026-09-27T04:10:00.000Z");
    const res = await runNightlyExports({ store, now });
    expect(res.failed).toEqual([]);
    const orgs = (
      await pb.collection("organizations").getFullList({ fields: "id" })
    ).map((o) => o.id);
    expect(res.exported.map((e) => e.orgId).sort()).toEqual(orgs.sort());
    for (const { orgId, key } of res.exported) {
      expect(key).toBe(tenantExportKey(orgId, now));
      expect(await store.get(key)).not.toBeNull();
      const rows = await pb.collection("audit_log").getFullList({
        filter: pb.filter(
          "organization = {:org} && action = 'tenant.export' && actor = ''",
          { org: orgId },
        ),
      });
      expect(rows).toHaveLength(1);
      expect((rows[0]!.meta as Record<string, unknown>).job).toBe(
        "nightly-export",
      );
    }
    expect(res.exported.map((e) => e.orgId)).toContain(c.id);
  });
});
