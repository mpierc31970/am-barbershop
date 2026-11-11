// 13-18 (STAFF-14, D155, D269, D291): capture → sync → pending → convert, end to end, with
// the real apps/failsafe server (13-04) on a free port and the fixture premium add-on.
// jobSyncFailsafe stores under the right org (slug + installed add-on), is idempotent by
// capture_id and acks only stored ids; staff list, convert (the add-on's own conflict check)
// and dismiss; org B's scope cannot touch org A's row; a member context is refused.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { InvalidContext, InvalidInput, NotFound } from "@cds/core";
import {
  FIXTURE_PREMIUM_ITEMS,
  FIXTURE_PREMIUM_OK,
} from "../../core/src/addons/__fixtures__/manifests";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import type { PlatformContext } from "../src/context";
import {
  FAILSAFE_MAX_STORE_ATTEMPTS,
  failsafeStatus,
  getFailsafeCapture,
  jobSyncFailsafe,
  listPendingRequests,
  staffConvertFailsafeRequest,
  staffDismissFailsafeRequest,
  staffListFailsafeRequests,
} from "../src/staff/failsafe";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import { staffContext } from "./seeded";

const KEY = randomBytes(32).toString("base64");
const SECRET = "failsafe-integration-secret";
const ADDON = "fixture-premium";
const MANIFESTS = [FIXTURE_PREMIUM_OK];

// apps/failsafe uses .ts-extension imports (node --experimental-strip-types); @cds/db's
// tsconfig does not allow them, so the server module is loaded by URL at runtime.
type FailsafeServerModule = {
  createFailsafeServer(opts: {
    dataDir: string;
    dataKey: string;
    pullSecret: string;
    routing: {
      orgSlug: string;
      addon: string;
      ownerEmail: string;
      staffEmail: string;
    }[];
    log?: (line: string) => void;
    mail?: unknown;
  }): Server;
};

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let superCtx: PlatformContext;
let agentCtx: PlatformContext;
let server: Server;
let base: string;
let dataDir: string;
const savedEnv = {
  CDS_FAILSAFE: process.env.CDS_FAILSAFE,
  FAILSAFE_URL: process.env.FAILSAFE_URL,
  FAILSAFE_PULL_SECRET: process.env.FAILSAFE_PULL_SECRET,
};

async function capture(
  orgSlug: string,
  fields: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${base}/r/${orgSlug}/${ADDON}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      name: "Ana Visitor",
      email: "ana@example.com",
      phone: "",
      preferred: "Tuesday morning",
      message: "Please call me.",
      ...fields,
    }).toString(),
  });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  await pb.collection("organizations").update(seed.A.org, {
    name: "Rivera Salon",
  });
  // The premium add-on is installed on org A only; org B is routed on the fail-safe but has
  // no install, so its request is unmatched (T-13-18-03).
  await pb.collection("org_addons").create({
    organization: seed.A.org,
    addon: ADDON,
    status: "active",
    source: "staff",
  });
  superCtx = await staffContext(inst, "fs-super@cds.test", "super_admin");
  agentCtx = await staffContext(inst, "fs-agent@cds.test", "support_agent");

  const modUrl = pathToFileURL(
    resolve(__dirname, "../../../apps/failsafe/src/server.ts"),
  ).href;
  const mod = (await import(/* @vite-ignore */ modUrl)) as FailsafeServerModule;
  dataDir = mkdtempSync(join(tmpdir(), "failsafe-int-"));
  server = mod.createFailsafeServer({
    dataDir,
    dataKey: KEY,
    pullSecret: SECRET,
    routing: ["org-a", "org-b"].map((orgSlug) => ({
      orgSlug,
      addon: ADDON,
      ownerEmail: `owner@${orgSlug}.example`,
      staffEmail: "staff@cds.example",
    })),
    log: () => {},
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.CDS_FAILSAFE = "http";
  process.env.FAILSAFE_URL = base;
  process.env.FAILSAFE_PULL_SECRET = SECRET;
});

afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  await inst?.stop();
});

async function pendingFor(name: string) {
  const rows = await staffListFailsafeRequests(agentCtx, { orgId: seed.A.org });
  return rows.find((r) => r.name === name);
}

describe("jobSyncFailsafe (choice 3)", () => {
  it("stores org A's request, keeps org B's as unmatched for staff, acks, and is idempotent", async (t) => {
    if (!inst) return t.skip();
    expect(getFailsafeCapture().name).toBe("http");
    await capture("org-a", {});
    await capture("org-b", { name: "Bea Visitor" });
    const first = await jobSyncFailsafe();
    expect(first).toEqual({
      pulled: 2,
      stored: 1,
      duplicates: 0,
      unmatched: 1,
      rematched: 0,
      acked: 1,
      failed: 0,
      parked: 0,
    });
    const rows = await pb.collection("failsafe_requests").getFullList({
      filter: pb.filter("addon = {:a}", { a: ADDON }),
      sort: "captured_at",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      organization: seed.A.org,
      name: "Ana Visitor",
      status: "pending",
    });
    expect(rows[0]!.capture_id).toMatch(/^[0-9a-f]{24}$/);
    // CR-A01: never dropped. Org B has no install: stored org-less, staff-only.
    expect(rows[1]).toMatchObject({
      organization: "",
      org_slug: "org-b",
      reason: "addon_inactive",
      name: "Bea Visitor",
      status: "unmatched",
    });
    expect(await listPendingRequests(seed.ctxB, ADDON)).toEqual([]);
    const staffRows = await staffListFailsafeRequests(agentCtx);
    expect(staffRows.find((r) => r.name === "Bea Visitor")).toMatchObject({
      status: "pending",
      unmatched: { orgSlug: "org-b", reason: "addon_inactive" },
    });

    const second = await jobSyncFailsafe();
    expect(second.stored).toBe(0);
    expect(second.unmatched).toBe(0);
    expect(second.pulled).toBe(0);
    const status = await failsafeStatus();
    expect(status).toMatchObject({ active: false, deployed: true });
    expect(status.pending_requests).toBeGreaterThanOrEqual(2);
    expect(status.last_pull).not.toBeNull();
  });

  it("an unmatched request cannot convert; it moves to its site once the add-on is active", async (t) => {
    if (!inst) return t.skip();
    const bea = (await staffListFailsafeRequests(agentCtx)).find(
      (r) => r.name === "Bea Visitor",
    )!;
    await expect(
      staffConvertFailsafeRequest(superCtx, bea.id, { manifests: MANIFESTS }),
    ).rejects.toThrow(/matched no site/);
    const install = await pb.collection("org_addons").create({
      organization: seed.B.org,
      addon: ADDON,
      status: "active",
      source: "staff",
    });
    try {
      const run = await jobSyncFailsafe();
      expect(run.rematched).toBe(1);
      expect(run.acked).toBe(1);
      const row = await pb.collection("failsafe_requests").getOne(bea.id);
      expect(row).toMatchObject({
        organization: seed.B.org,
        status: "pending",
        reason: "",
      });
      expect(
        (await listPendingRequests(seed.ctxB, ADDON)).map((r) => r.name),
      ).toContain("Bea Visitor");
      await staffDismissFailsafeRequest(agentCtx, bea.id, "Test cleanup.");
    } finally {
      await pb.collection("org_addons").delete(install.id);
    }
  });
});

describe("staff inbox (choice 4)", () => {
  it("lists the request pending with the business name", async (t) => {
    if (!inst) return t.skip();
    const row = await pendingFor("Ana Visitor");
    expect(row).toMatchObject({
      orgId: seed.A.org,
      business: "Rivera Salon",
      addon: ADDON,
      status: "pending",
      email: "ana@example.com",
    });
  });

  it("the tenant read shows org A's pending request, org B sees none of it", async (t) => {
    if (!inst) return t.skip();
    const a = await listPendingRequests(seed.ctxA, ADDON);
    expect(a.map((r) => r.name)).toContain("Ana Visitor");
    const b = await listPendingRequests(seed.ctxB, ADDON);
    expect(b.map((r) => r.orgId)).not.toContain(seed.A.org);
  });

  it("convert creates the add-on record, marks it converted and audits", async (t) => {
    if (!inst) return t.skip();
    const row = (await pendingFor("Ana Visitor"))!;
    const res = await staffConvertFailsafeRequest(superCtx, row.id, {
      manifests: MANIFESTS,
    });
    expect(res.converted).toBe(true);
    const ref = (res as { ref: string }).ref;
    expect(FIXTURE_PREMIUM_ITEMS.find((i) => i.id === ref)).toMatchObject({
      orgId: seed.A.org,
      captureId: row.captureId,
    });
    const stored = await pb.collection("failsafe_requests").getOne(row.id);
    expect(stored).toMatchObject({ status: "converted", converted_ref: ref });
    expect(stored.handled_by).toBe(superCtx.actor);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'failsafe.converted' && target_id = {:id}", {
        id: row.id,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.organization).toBe(seed.A.org);
    // A second click finds it handled (T-13-18-04).
    await expect(
      staffConvertFailsafeRequest(superCtx, row.id, { manifests: MANIFESTS }),
    ).rejects.toThrow(InvalidInput);
  });

  it("a 'taken' request returns the add-on's conflict and stays pending", async (t) => {
    if (!inst) return t.skip();
    await capture("org-a", { name: "Cy Taken", preferred: "taken" });
    expect((await jobSyncFailsafe()).stored).toBe(1);
    const row = (await pendingFor("Cy Taken"))!;
    const before = FIXTURE_PREMIUM_ITEMS.length;
    const res = await staffConvertFailsafeRequest(agentCtx, row.id, {
      manifests: MANIFESTS,
    });
    expect(res).toEqual({
      converted: false,
      conflict: "That time is already taken.",
    });
    expect(FIXTURE_PREMIUM_ITEMS.length).toBe(before);
    expect(
      (await pb.collection("failsafe_requests").getOne(row.id)).status,
    ).toBe("pending");
  });

  it("two converts at once run the add-on hook once (WR-A02)", async (t) => {
    if (!inst) return t.skip();
    await capture("org-a", { name: "Eve Double" });
    expect((await jobSyncFailsafe()).stored).toBe(1);
    const row = (await pendingFor("Eve Double"))!;
    const before = FIXTURE_PREMIUM_ITEMS.length;
    const results = await Promise.allSettled([
      staffConvertFailsafeRequest(superCtx, row.id, { manifests: MANIFESTS }),
      staffConvertFailsafeRequest(agentCtx, row.id, { manifests: MANIFESTS }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(FIXTURE_PREMIUM_ITEMS.length).toBe(before + 1);
    expect(
      (await pb.collection("failsafe_requests").getOne(row.id)).status,
    ).toBe("converted");
  });

  it("dismiss writes dismissed + audit (support_agent); a member context is refused", async (t) => {
    if (!inst) return t.skip();
    const row = (await pendingFor("Cy Taken"))!;
    await expect(
      staffDismissFailsafeRequest(
        seed.ctxA as unknown as PlatformContext,
        row.id,
        "spam",
      ),
    ).rejects.toThrow(InvalidContext);
    await expect(
      staffListFailsafeRequests(seed.ctxA as unknown as PlatformContext),
    ).rejects.toThrow(InvalidContext);
    await expect(
      staffDismissFailsafeRequest(agentCtx, row.id, " "),
    ).rejects.toThrow(InvalidInput);
    const res = await staffDismissFailsafeRequest(
      agentCtx,
      row.id,
      "Called them back by phone.",
    );
    expect(res.dismissedAt).not.toBe("");
    const stored = await pb.collection("failsafe_requests").getOne(row.id);
    expect(stored.status).toBe("dismissed");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'failsafe.dismissed' && target_id = {:id}", {
        id: row.id,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.organization).toBe(seed.A.org);
  });

  it("scoped to org B, org A's row is NotFound for list, convert and dismiss", async (t) => {
    if (!inst) return t.skip();
    await capture("org-a", { name: "Dee Scoped" });
    await jobSyncFailsafe();
    const row = (await pendingFor("Dee Scoped"))!;
    const listB = await staffListFailsafeRequests(superCtx, {
      orgId: seed.B.org,
      status: "all",
    });
    expect(listB.map((r) => r.id)).not.toContain(row.id);
    await expect(
      staffConvertFailsafeRequest(superCtx, row.id, {
        manifests: MANIFESTS,
        orgId: seed.B.org,
      }),
    ).rejects.toThrow(NotFound);
    await expect(
      staffDismissFailsafeRequest(superCtx, row.id, "x", { orgId: seed.B.org }),
    ).rejects.toThrow(NotFound);
    expect(
      (await pb.collection("failsafe_requests").getOne(row.id)).status,
    ).toBe("pending");
  });
});

// Runs last: the fake captures move the cursor, so the cursor is put back afterwards.
describe("a request PocketBase would reject never stalls the cursor (WR-A01)", () => {
  function fakeCapture(items: unknown[]) {
    return {
      name: "http" as const,
      pull: async () => items as never,
      ack: async () => {},
      status: async () => "ok" as const,
    };
  }
  function poison(id: string, extra: Record<string, string> = {}) {
    return {
      id,
      orgSlug: "org-a",
      addon: ADDON,
      name: "Odd Request",
      email: "",
      phone: "",
      preferred: "",
      message: "",
      created_at: "2099-01-01T00:00:00.000Z",
      ...extra,
    };
  }
  async function cursorRow() {
    return pb
      .collection("platform_meta")
      .getFirstListItem(pb.filter("key = {:k}", { k: "failsafe:last_pull" }));
  }

  it("an email PocketBase's email field would reject is stored as given", async (t) => {
    if (!inst) return t.skip();
    const saved = await cursorRow();
    try {
      const run = await jobSyncFailsafe(new Date(), {
        capture: fakeCapture([
          poison("poison-email-1", { email: "not quite@an-email" }),
        ]),
      });
      expect(run).toMatchObject({ stored: 1, failed: 0 });
      const row = await pb
        .collection("failsafe_requests")
        .getFirstListItem(
          pb.filter("capture_id = {:c}", { c: "poison-email-1" }),
        );
      expect(row.email).toBe("not quite@an-email");
      await staffDismissFailsafeRequest(agentCtx, row.id, "Test cleanup.");
    } finally {
      await pb
        .collection("platform_meta")
        .update(saved.id, { value: saved.value });
    }
  });

  it("a create that keeps failing holds the cursor, then is parked for staff", async (t) => {
    if (!inst) return t.skip();
    const saved = await cursorRow();
    // Make the column stricter than the capture form so the create is rejected every run.
    const col = await pb.collections.getOne("failsafe_requests");
    const fields = col.fields.map((f) =>
      f.name === "preferred" ? { ...f, max: 5 } : f,
    );
    await pb.collections.update(col.id, { fields });
    try {
      const items = [poison("poison-long-1", { preferred: "Tuesday morning" })];
      for (let i = 1; i < FAILSAFE_MAX_STORE_ATTEMPTS; i++) {
        const run = await jobSyncFailsafe(new Date(), {
          capture: fakeCapture(items),
        });
        expect(run).toMatchObject({ failed: 1, parked: 0 });
        expect((await cursorRow()).value).toBe(saved.value);
      }
      const last = await jobSyncFailsafe(new Date(), {
        capture: fakeCapture(items),
      });
      expect(last).toMatchObject({ failed: 0, parked: 1, acked: 0 });
      expect((await cursorRow()).value).toBe("2099-01-01T00:00:00.000Z");
      const row = await pb
        .collection("failsafe_requests")
        .getFirstListItem(
          pb.filter("capture_id = {:c}", { c: "poison-long-1" }),
        );
      expect(row).toMatchObject({
        organization: "",
        status: "unmatched",
        reason: "store_failed",
        org_slug: "org-a",
      });
      expect(
        (await staffListFailsafeRequests(agentCtx)).map((r) => r.id),
      ).toContain(row.id);
    } finally {
      await pb.collections.update(col.id, { fields: col.fields });
      await pb
        .collection("platform_meta")
        .update(saved.id, { value: saved.value });
    }
  });
});
