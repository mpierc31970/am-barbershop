// 13-24: the demo flag at the shared choke points (STAFF-18, D293, Invariant 2) on the real
// PocketBase 0.39.11 binary. For the demo org: mail is dropped ("demo: not sent"), payments are
// forced to the fake adapter, screen() and image moderation answer clean without a provider or
// a flag, the pinger and the weekly indexing job skip. Non-demo orgs are unchanged. Only
// demo/flag.ts (staff `demo_reset` or a system job) writes organizations.demo (T-13-24-03).
import "@cds/addon-registry/server";
import { Forbidden, InvalidContext } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { createPage } from "../src/content/pages";
import {
  recordingInvalidator,
  type ImageModerator,
  type SearchPinger,
} from "../src/content/ports";
import { publishPage, type PublishDeps } from "../src/content/publish";
import { saveSection } from "../src/content/sections";
import { mintSystemContext, type OrgContext } from "../src/context";
import {
  __clearDemoCacheForTests,
  orgIsDemo,
  setOrgDemoFlag,
} from "../src/demo/flag";
import { sendEmail } from "../src/email/send";
import { captureTransport } from "../src/email/transport";
import { runIndexingJob } from "../src/jobs/indexing";
import { solidPng } from "../src/media/__fixtures__/make-fixtures";
import { uploadLibraryImage } from "../src/media/library";
import {
  cdsBillingFor,
  paymentsModeFor,
  resetPaymentsForTests,
} from "../src/payments/factory";
import { getObjectStore, type ObjectStore } from "../src/storage";
import { notifySupport } from "../src/support/notify";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z");
const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let storageDir: string;
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;
let ctxA: OrgContext;
let ctxB: OrgContext; // B is the demo org

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-demo-flag-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  __clearDemoCacheForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  ctxA = s.base.ctxA;
  ctxB = s.base.ctxB;
  // Both orgs live, so publish pings and the weekly job considers them.
  await pb.collection("organizations").update(s.A.org, { stage: "live" });
  await pb.collection("organizations").update(s.B.org, { stage: "live" });
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

describe("setOrgDemoFlag (staff demo_reset or system only)", () => {
  it("refuses a support_agent and an unminted context; super_admin sets it with an audit row", async (t) => {
    if (!inst) return t.skip();
    await expect(
      setOrgDemoFlag(s.staff.agent, s.B.org, true),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      setOrgDemoFlag(
        { job: "fake" } as unknown as Parameters<typeof setOrgDemoFlag>[0],
        s.B.org,
        true,
      ),
    ).rejects.toBeInstanceOf(InvalidContext);
    expect(await orgIsDemo(s.B.org)).toBe(false);

    await setOrgDemoFlag(s.staff.superAdmin, s.B.org, true);
    expect((await pb.collection("organizations").getOne(s.B.org)).demo).toBe(
      true,
    );
    expect(await orgIsDemo(s.B.org)).toBe(true);
    expect(await orgIsDemo(s.A.org)).toBe(false);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'site.demo_flag_set'",
        {
          o: s.B.org,
        },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toEqual({ demo: true });
  });

  it("a system job can set it (the demo seed, 13-31)", async (t) => {
    if (!inst) return t.skip();
    await setOrgDemoFlag(
      mintSystemContext({ job: "demo-seed" }),
      s.B.org,
      true,
    );
    expect(await orgIsDemo(s.B.org)).toBe(true);
  });

  it("orgIsDemo is false for a bad or unknown id", async () => {
    expect(await orgIsDemo("not an id")).toBe(false);
    if (!inst) return;
    expect(await orgIsDemo("zzzzzzzzzzzzzzz")).toBe(false);
  });
});

describe("email (D293): mail about the demo org is dropped", () => {
  it("an org-sent mail is skipped and logs 'demo: not sent'; a real org's mail is sent", async (t) => {
    if (!inst) return t.skip();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const transport = captureTransport();
      const data = { orgName: "Bella's Salon", subject: "Thanks", body: "Hi" };
      const demo = await sendEmail(
        {
          kind: "org",
          ctx: mintSystemContext({ job: "test" }),
          orgId: s.B.org,
        },
        "form.auto_reply",
        "visitor@example.com",
        data,
        { transport },
      );
      expect(demo).toEqual({ status: "skipped", reason: "demo" });
      expect(transport.sent).toHaveLength(0);
      expect(info.mock.calls.map((c) => String(c[0]))).toContain(
        "[email] demo: not sent",
      );

      const real = await sendEmail(
        {
          kind: "org",
          ctx: mintSystemContext({ job: "test" }),
          orgId: s.A.org,
        },
        "form.auto_reply",
        "visitor@example.com",
        data,
        { transport },
      );
      expect(real).toEqual({ status: "sent" });
      expect(transport.sent).toHaveLength(1);
    } finally {
      info.mockRestore();
    }
  });

  it("CDS support notices about the demo org are not emailed (concernsOrg); bell rows still raised", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const input = (org: SupportSeed["A"], n: number) => ({
      orgId: org.org,
      as: s.staff.agent,
      type: "support.reply" as const,
      ticket: { number: n, subject: "Menu photo", filer: org.users.editor },
      title: `CDS replied to ticket #${n}`,
      href: `/hub/support/tickets/${n}`,
      excerpt: "Swapped it.",
      authorFirstName: "Mara",
      businessName: "Bella's Salon",
    });
    const demo = await notifySupport(input(s.B, 2042), { now: AT, transport });
    expect(demo.emailed).toBe(0);
    expect(demo.raised).toBeGreaterThan(0);
    expect(transport.sent).toHaveLength(0);

    const real = await notifySupport(input(s.A, 2043), { now: AT, transport });
    expect(real.emailed).toBeGreaterThan(0);
    expect(transport.sent.length).toBe(real.emailed);
  });
});

describe("payments (D293): the demo org is always on the fake adapter", () => {
  it("paymentsModeFor is fake for demo even with CDS_PAYMENTS=stripe", async (t) => {
    if (!inst) return t.skip();
    const saved = process.env.CDS_PAYMENTS;
    process.env.CDS_PAYMENTS = "stripe";
    resetPaymentsForTests();
    try {
      expect(await paymentsModeFor(s.B.org)).toBe("fake");
      expect(await paymentsModeFor(s.A.org)).toBe("stripe");
      expect((await cdsBillingFor(s.B.org)).provider).toBe("fake");
    } finally {
      if (saved === undefined) delete process.env.CDS_PAYMENTS;
      else process.env.CDS_PAYMENTS = saved;
      resetPaymentsForTests();
    }
  });
});

let slugN = 0;
async function heldPage(ctx: OrgContext): Promise<string> {
  slugN += 1;
  const page = await createPage(
    ctx,
    { title: `Demo ${slugN}`, slug: `demo-${slugN}` },
    store,
  );
  await saveSection(ctx, registry, {
    pageId: page.id,
    section_type: "text-only",
    row_layout: "full",
    content: { heading: "Offer", text: "<p>Buy __cds_test_held__ now</p>" },
  });
  return page.id;
}

async function flagsFor(targetId: string) {
  return pb.collection("content_flags").getFullList({
    filter: pb.filter("target_id = {:id}", { id: targetId }),
  });
}

describe("scan + pinger (D293)", () => {
  it("demo: held text publishes, no flag, the pinger is never called and nothing is recorded", async (t) => {
    if (!inst) return t.skip();
    const pings: string[][] = [];
    const pinger: SearchPinger = {
      ping: (urls) => {
        pings.push(urls);
        return Promise.resolve();
      },
    };
    const deps: PublishDeps = {
      sections: registry,
      invalidator: recordingInvalidator(),
      pinger,
      store,
    };
    const demoPage = await heldPage(ctxB);
    const res = await publishPage(ctxB, demoPage, deps);
    expect(res.status).toBe("published");
    expect(await flagsFor(demoPage)).toHaveLength(0);
    expect(pings).toHaveLength(0);
    const idx = await pb.collection("org_indexing").getList(1, 1, {
      filter: pb.filter("org_id = {:o}", { o: s.B.org }),
    });
    expect(idx.totalItems).toBe(0);

    const realPage = await heldPage(ctxA);
    const real = await publishPage(ctxA, realPage, deps);
    expect(real.status).toBe("held");
    expect((await flagsFor(realPage)).map((f) => f.verdict)).toEqual(["held"]);
  });

  it("demo: an image upload never reaches the moderator; a real org's does", async (t) => {
    if (!inst) return t.skip();
    const seen: string[] = [];
    const moderator: ImageModerator = {
      name: "spy",
      check(input) {
        seen.push(input.orgId);
        return Promise.resolve({
          verdict: "held",
          reasons: ["x"],
          provider: "spy",
        });
      },
    };
    const { asset } = await uploadLibraryImage(ctxB, await solidPng(40, 30), {
      store,
      moderator,
    });
    expect(asset.status).toBe("ready");
    expect(seen).toEqual([]);
    expect(await flagsFor(asset.id)).toHaveLength(0);

    const real = await uploadLibraryImage(ctxA, await solidPng(40, 30), {
      store,
      moderator,
    });
    expect(seen).toEqual([s.A.org]);
    expect(real.asset.status).toBe("held");
  });

  it("runIndexingJob skips the demo org", async (t) => {
    if (!inst) return t.skip();
    const res = await runIndexingJob({ now: AT, dryRun: true, store });
    expect(res.skippedDemo).toBe(1);
  });
});

describe("no tenant write path to organizations.demo (T-13-24-03)", () => {
  it("a signed-in owner cannot write organizations.demo directly", async (t) => {
    if (!inst) return t.skip();
    const email = `demo-owner-${Date.now()}@example.com`;
    const password = `pw-${Math.random().toString(36).slice(2)}-x9`;
    const u = await pb
      .collection("users")
      .create({ email, password, passwordConfirm: password });
    await pb
      .collection("memberships")
      .create({ user: u.id, organization: s.A.org, role: "owner" });
    const client = new PocketBase(inst.url);
    await client.collection("users").authWithPassword(email, password, {
      headers: { "X-CDS-App-Key": inst.appKey },
    });
    expect(client.authStore.isValid).toBe(true);
    await expect(
      client.collection("organizations").update(s.A.org, { demo: true }),
    ).rejects.toBeTruthy();
    expect((await pb.collection("organizations").getOne(s.A.org)).demo).toBe(
      false,
    );
  });

  it("only packages/db/src/demo/ writes the demo field in @cds/db source", () => {
    const root = join(__dirname, "..", "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!p.endsWith(".ts") || p.endsWith(".test.ts")) continue;
        if (p.replace(/\\/g, "/").includes("/src/demo/")) continue;
        const src = readFileSync(p, "utf8");
        if (/\.(update|create)\([^;]*?\bdemo\s*:/s.test(src)) {
          offenders.push(p);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
