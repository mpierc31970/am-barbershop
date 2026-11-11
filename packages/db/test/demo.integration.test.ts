// 13-31: the permanent demo tenant on the real PocketBase 0.39.11 binary (STAFF-18, D293,
// RESEARCH Pitfall 11). ensureDemoOrg is idempotent and refuses a non-demo "demo" slug; the
// seed is fake content with example.com addresses only and never exposes the owner password;
// resetDemoOrg wipes and reseeds ONLY the demo org (another org's rows and updated stamps are
// identical, the demo org id and host are kept); staff "Reset now" needs demo_reset.
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Forbidden, InvalidInput } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import { saveContact } from "../src/contacts/contacts";
import { mintOrgContext, mintSystemContext } from "../src/context";
import { __clearDemoCacheForTests } from "../src/demo/flag";
import {
  DEMO_LAST_RESET_KEY,
  demoResetPreview,
  resetDemoOrg,
  staffResetDemo,
} from "../src/demo/reset";
import {
  DEMO_OWNER_EMAIL,
  DEMO_OWNER_ID_KEY,
  DEMO_SLUG,
  ensureDemoOrg,
  findDemoOrgId,
} from "../src/demo/seed";
import { sendEmail } from "../src/email/send";
import { captureTransport } from "../src/email/transport";
import {
  DEMO_JOB_COUNTS_KEY,
  DEMO_JOB_SUCCESS_KEY,
  demoResetClaimKey,
  isDemoResetHour,
  runDemoResetJob,
} from "../src/jobs/demo";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
} from "../src/platform-meta";
import { allTenantCollections } from "../src/registry";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-15T08:30:00.000Z"); // 3:30 am Chicago (CDT)
const sections = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_REGISTRY.sections(),
);

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let storageDir = "";
const savedStorageDir = process.env.CDS_STORAGE_DIR;

function deps() {
  return {
    addons: ADDON_REGISTRY,
    sections,
    invalidator: recordingInvalidator(),
    now: AT,
  };
}

/** Every tenant row of one org: `collection:id -> updated`. */
async function snapshot(orgId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of Object.keys(allTenantCollections())) {
    const rows = await pb.collection(name).getFullList({
      filter: pb.filter("organization = {:org}", { org: orgId }),
    });
    for (const r of rows) out.set(`${name}:${r.id}`, String(r.updated ?? ""));
  }
  return out;
}

async function count(name: string, orgId: string): Promise<number> {
  return (
    await pb.collection(name).getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: orgId }),
    })
  ).totalItems;
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-demo-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  __clearDemoCacheForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
}, 120_000);

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("ensureDemoOrg", () => {
  it("refuses an existing demo slug whose org is not the demo, writing nothing", async (t) => {
    if (!inst) return t.skip();
    const imposter = await pb
      .collection("organizations")
      .create({ name: "Real Demo Co", slug: DEMO_SLUG, status: "active" });
    const sys = mintSystemContext({ job: "test" });
    await expect(ensureDemoOrg(sys, { now: AT })).rejects.toBeInstanceOf(
      InvalidInput,
    );
    await expect(findDemoOrgId()).rejects.toBeInstanceOf(InvalidInput);
    expect(
      (await pb.collection("organizations").getOne(imposter.id)).demo,
    ).not.toBe(true);
    expect(await count("org_hosts", imposter.id)).toBe(0);
    await pb.collection("organizations").delete(imposter.id);
  });

  it("is idempotent: one org, slug demo, demo true, Studio, live, preview host", async (t) => {
    if (!inst) return t.skip();
    const sys = mintSystemContext({ job: "test" });
    const first = await ensureDemoOrg(sys, { now: AT });
    const second = await ensureDemoOrg(sys, { now: AT });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.orgId).toBe(first.orgId);
    expect(Object.keys(first).sort()).toEqual(["created", "orgId", "ownerId"]);
    const orgs = await pb.collection("organizations").getFullList({
      filter: pb.filter("slug = {:s}", { s: DEMO_SLUG }),
    });
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.demo).toBe(true);
    expect(orgs[0]!.name).toBe("Bella's Salon");
    expect(orgs[0]!.path).toBe("studio");
    expect(orgs[0]!.stage).toBe("live");
    const hosts = await pb.collection("org_hosts").getFullList({
      filter: pb.filter("organization = {:o}", { o: first.orgId }),
    });
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.kind).toBe("preview");
    expect(hosts[0]!.hostname).toBe("demo.sites.localhost");
    const owner = await pb.collection("users").getOne(first.ownerId);
    expect(owner.email).toBe(DEMO_OWNER_EMAIL);
    // WR-A09: the seed records the account it created.
    expect(await readPlatformMeta(DEMO_OWNER_ID_KEY)).toBe(first.ownerId);
  });

  it("refuses a demo-email account the seed did not create (WR-A09)", async (t) => {
    if (!inst) return t.skip();
    const sys = mintSystemContext({ job: "test" });
    const marker = await pb
      .collection("platform_meta")
      .getFirstListItem(pb.filter("key = {:k}", { k: DEMO_OWNER_ID_KEY }));
    // As if the account with the demo email were someone else's (a sign-up, a restore).
    await pb
      .collection("platform_meta")
      .update(marker.id, { value: "zzzzzzzzzzzzzzz" });
    try {
      await expect(ensureDemoOrg(sys, { now: AT })).rejects.toThrow(
        /did not create/,
      );
    } finally {
      await pb
        .collection("platform_meta")
        .update(marker.id, { value: marker.value });
    }
    expect((await ensureDemoOrg(sys, { now: AT })).ownerId).toBe(marker.value);
  });
});

describe("resetDemoOrg", () => {
  it("seeds fake content (example.com only) and leaves another org untouched", async (t) => {
    if (!inst) return t.skip();
    const orgId = (await findDemoOrgId())!;
    const hostBefore = await pb.collection("org_hosts").getFullList({
      filter: pb.filter("organization = {:o}", { o: orgId }),
    });
    const beforeA = await snapshot(s.A.org);
    const beforeB = await snapshot(s.B.org);
    expect(beforeB.size).toBeGreaterThan(5);
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      }),
    );
    let r;
    try {
      r = await resetDemoOrg(mintSystemContext({ job: "test" }), deps());
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(r.orgId).toBe(orgId);
    expect(r.rowsSeeded).toBeGreaterThan(10);
    expect(Object.keys(r).sort()).toEqual([
      "orgId",
      "rowsDeleted",
      "rowsSeeded",
    ]);
    expect(logs.join("\n")).not.toMatch(/password/i);

    // Other orgs: identical rows and updated stamps.
    expect(await snapshot(s.A.org)).toEqual(beforeA);
    expect(await snapshot(s.B.org)).toEqual(beforeB);

    // Content.
    const contacts = await pb.collection("contacts").getFullList({
      filter: pb.filter("organization = {:o}", { o: orgId }),
    });
    expect(contacts).toHaveLength(6);
    for (const c of contacts) expect(String(c.email)).toMatch(/@example\.com$/);
    const pages = await pb.collection("pages").getFullList({
      filter: pb.filter("organization = {:o} && status = 'published'", {
        o: orgId,
      }),
    });
    expect(pages.map((p) => p.slug)).toEqual(
      expect.arrayContaining(["home", "about", "services", "contact"]),
    );
    expect(await count("testimonials", orgId)).toBe(3);
    expect(await count("credentials", orgId)).toBe(2);
    expect(await count("forms", orgId)).toBe(1);
    expect(await count("support_threads", orgId)).toBe(1);
    expect(await count("support_messages", orgId)).toBe(2);
    // WR-A08: the seeded ticket is closed and CDS-opened, so staff queues and the SLA
    // report never count it.
    const demoTicket = await pb
      .collection("support_threads")
      .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }));
    expect(demoTicket).toMatchObject({ status: "closed", opened_by_cds: true });
    const org = await pb.collection("organizations").getOne(orgId);
    expect(org.design?.name).toBe("Bella's Salon");
    expect(
      await pb.collection("org_hosts").getFullList({
        filter: pb.filter("organization = {:o}", { o: orgId }),
      }),
    ).toEqual(hostBefore);
    expect(await readPlatformMeta(DEMO_LAST_RESET_KEY)).toBe(AT.toISOString());
  }, 120_000);

  it("a second reset wipes and reseeds the same content, keeping the org id, host and owner", async (t) => {
    if (!inst) return t.skip();
    const orgId = (await findDemoOrgId())!;
    // Something a visitor to the demo changed: an extra contact.
    const owner = await pb
      .collection("users")
      .getFirstListItem(pb.filter("email = {:e}", { e: DEMO_OWNER_EMAIL }));
    await saveContact(
      mintOrgContext({
        orgId,
        actor: owner.id,
        role: "owner",
        grants: [],
        ip: "test",
      }),
      { name: "Extra", email: "extra@example.com" },
    );
    const preview = await demoResetPreview();
    expect(preview.exists).toBe(true);
    expect(preview.rowsToDelete).toBeGreaterThan(10);
    const beforeB = await snapshot(s.B.org);
    const r = await resetDemoOrg(mintSystemContext({ job: "test" }), deps());
    expect(r.orgId).toBe(orgId);
    expect(r.rowsDeleted).toBe(preview.rowsToDelete);
    expect(await count("contacts", orgId)).toBe(6);
    expect(await count("testimonials", orgId)).toBe(3);
    expect(await count("support_threads", orgId)).toBe(1);
    expect(await count("memberships", orgId)).toBe(1);
    expect(await snapshot(s.B.org)).toEqual(beforeB);
    // The audit log was wiped and holds only this reset's rows.
    const resets = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'demo.reset'", {
        o: orgId,
      }),
    });
    expect(resets).toHaveLength(1);
  }, 120_000);

  it("mail for the demo org is dropped (nothing captured)", async (t) => {
    if (!inst) return t.skip();
    const orgId = (await findDemoOrgId())!;
    const transport = captureTransport();
    const res = await sendEmail(
      { kind: "org", ctx: mintSystemContext({ job: "test" }), orgId },
      "form.auto_reply",
      "visitor@example.com",
      { orgName: "Bella's Salon", subject: "Thanks", body: "Hi" },
      { transport },
    );
    expect(res).toEqual({ status: "skipped", reason: "demo" });
    expect(transport.sent).toHaveLength(0);
  });
});

describe("staffResetDemo", () => {
  it("refuses a support_agent; super_admin resets and is named in the audit row", async (t) => {
    if (!inst) return t.skip();
    await expect(staffResetDemo(s.staff.agent, deps())).rejects.toBeInstanceOf(
      Forbidden,
    );
    // WR-A07: resetDemoOrg checks the role itself, not only staffResetDemo.
    await expect(resetDemoOrg(s.staff.agent, deps())).rejects.toBeInstanceOf(
      Forbidden,
    );
    const r = await staffResetDemo(s.staff.superAdmin, deps());
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'demo.reset'", {
        o: r.orgId,
      }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(s.staff.superAdminUser);
  }, 120_000);
});

describe("runDemoResetJob (hourly trigger, 3 am America/Chicago once a day)", () => {
  const CDT_330 = new Date("2026-10-16T08:30:00.000Z"); // Fri 3:30 am CDT (UTC-5)
  const CST_330 = new Date("2026-12-15T09:30:00.000Z"); // Tue 3:30 am CST (UTC-6)
  const CHI_10 = new Date("2026-10-16T15:00:00.000Z"); // 10:00 am CDT
  const jobDeps = () => ({
    addons: ADDON_REGISTRY,
    sections,
    invalidator: recordingInvalidator(),
  });

  it("reads the Chicago hour and day across DST", () => {
    expect(isDemoResetHour(CDT_330)).toBe(true);
    expect(isDemoResetHour(CST_330)).toBe(true);
    expect(isDemoResetHour(new Date("2026-12-15T08:30:00.000Z"))).toBe(false); // 2:30 CST
    expect(isDemoResetHour(CHI_10)).toBe(false);
    expect(demoResetClaimKey(CDT_330)).toBe("demo:reset:2026-10-16");
    expect(demoResetClaimKey(new Date("2026-10-17T04:00:00.000Z"))).toBe(
      "demo:reset:2026-10-16",
    );
  });

  it("10:00 Chicago: skippedHour 1, nothing deleted or written", async (t) => {
    if (!inst) return t.skip();
    const orgId = (await findDemoOrgId())!;
    const before = await snapshot(orgId);
    const r = await runDemoResetJob({ ...jobDeps(), now: CHI_10 });
    expect(r).toMatchObject({ skippedHour: 1, reset: 0, rowsDeleted: 0 });
    expect(await snapshot(orgId)).toEqual(before);
    expect(await readPlatformMeta(DEMO_JOB_SUCCESS_KEY)).toBeNull();
    expect(await readPlatformMeta(demoResetClaimKey(CHI_10))).toBeNull();
  });

  it("dry run at 3:30 counts what the wipe would delete and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const orgId = (await findDemoOrgId())!;
    const before = await snapshot(orgId);
    const r = await runDemoResetJob({
      ...jobDeps(),
      now: CDT_330,
      dryRun: true,
    });
    expect(r.dryRun).toBe(true);
    expect(r.reset).toBe(1);
    expect(r.rowsDeleted).toBe(before.size - 2); // minus org_hosts and the owner membership
    expect(await snapshot(orgId)).toEqual(before);
    expect(await readPlatformMeta(demoResetClaimKey(CDT_330))).toBeNull();
    expect(await readPlatformMeta(DEMO_JOB_COUNTS_KEY)).toBeNull();
  });

  it("3:30 CDT runs once; a second run the same night is skipped by the claim", async (t) => {
    if (!inst) return t.skip();
    const orgId = (await findDemoOrgId())!;
    const beforeB = await snapshot(s.B.org);
    const r = await runDemoResetJob({ ...jobDeps(), now: CDT_330 });
    expect(r).toMatchObject({
      dryRun: false,
      busy: false,
      reset: 1,
      skippedHour: 0,
      failedSteps: [],
    });
    expect(r.rowsDeleted).toBeGreaterThan(10);
    expect(r.rowsSeeded).toBeGreaterThan(10);
    expect(await readPlatformMeta(DEMO_JOB_SUCCESS_KEY)).toBe(
      CDT_330.toISOString(),
    );
    const counts = (await readPlatformMeta(DEMO_JOB_COUNTS_KEY))!;
    expect(JSON.parse(counts)).toEqual(r);
    expect(counts).not.toContain(orgId);
    expect(await readPlatformMeta(demoResetClaimKey(CDT_330))).not.toBeNull();
    expect(await snapshot(s.B.org)).toEqual(beforeB);

    const again = await runDemoResetJob({
      ...jobDeps(),
      now: new Date(CDT_330.getTime() + 20 * 60_000),
    });
    expect(again).toMatchObject({ skippedHour: 1, reset: 0 });
    expect(await readPlatformMeta(DEMO_JOB_SUCCESS_KEY)).toBe(
      CDT_330.toISOString(),
    );
  }, 120_000);

  it("3:30 CST (winter) runs too", async (t) => {
    if (!inst) return t.skip();
    const r = await runDemoResetJob({ ...jobDeps(), now: CST_330 });
    expect(r).toMatchObject({ reset: 1, skippedHour: 0, failedSteps: [] });
  }, 120_000);

  it("a failed seed gives the night back: the claim is released and a later run retries (WR-A10)", async (t) => {
    if (!inst) return t.skip();
    const night = new Date("2026-12-16T09:30:00.000Z"); // Wed 3:30 am CST
    const broken = {
      ...jobDeps(),
      addons: {
        ...ADDON_REGISTRY,
        get: () => {
          throw new Error("registry down");
        },
      } as unknown as typeof ADDON_REGISTRY,
    };
    const failed = await runDemoResetJob({ ...broken, now: night });
    expect(failed.failedSteps).toEqual(["seed"]);
    expect(await readPlatformMeta(demoResetClaimKey(night))).toBeNull();
    const retry = await runDemoResetJob({
      ...jobDeps(),
      now: new Date(night.getTime() + 10 * 60_000),
    });
    expect(retry).toMatchObject({ reset: 1, skippedHour: 0, failedSteps: [] });
  }, 120_000);

  it("force runs whatever the hour, without claiming the day", async (t) => {
    if (!inst) return t.skip();
    const r = await runDemoResetJob({ ...jobDeps(), now: CHI_10, force: true });
    expect(r).toMatchObject({ reset: 1, skippedHour: 0, failedSteps: [] });
    expect(await readPlatformMeta(DEMO_JOB_SUCCESS_KEY)).toBe(
      CHI_10.toISOString(),
    );
  }, 120_000);

  it("a held lock reads busy and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const at = new Date("2026-12-20T09:30:00.000Z");
    const token = (await acquirePlatformLock("lock:demo-job", {
      now: at,
      staleMs: 30 * 60_000,
    }))!;
    try {
      const r = await runDemoResetJob({ ...jobDeps(), now: at });
      expect(r.busy).toBe(true);
      expect(r.reset).toBe(0);
      expect(await readPlatformMeta(demoResetClaimKey(at))).toBeNull();
      await expect(
        staffResetDemo(s.staff.superAdmin, { ...jobDeps(), now: at }),
      ).rejects.toBeInstanceOf(InvalidInput);
    } finally {
      await releasePlatformLock("lock:demo-job", token);
    }
  });
});
