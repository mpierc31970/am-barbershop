// 13-17: site suspension on the real PocketBase binary (STAFF-22, D215, D218, P13-P3;
// T-13-17-01..05). Role gates, the resolver flag (cache cleared at once), the 3-day notice with
// owner mail + CDS note + urgent alert, the auto-suspend job around fix_by, mark fixed, lift,
// nothing deleted, and no tenant write path to the staff-only suspension json.
import "@cds/addon-registry/server";
import { Forbidden, InvalidInput } from "@cds/core";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import { captureTransport } from "../src/email/transport";
import { TENANT_COLLECTIONS } from "../src/registry";
import {
  clearResolverCache,
  isHostSuspended,
  resolveOrganization,
} from "../src/resolve";
import {
  jobAutoSuspend,
  staffLiftSuspension,
  staffMarkFixed,
  staffSendSuspensionNotice,
  staffSuspendNow,
  suspensionFixBy,
  suspensionStatusFor,
} from "../src/staff/suspension";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T22:00:00.000Z"); // Mon 12 Oct, 5:00 pm Chicago
const MIN = 60_000;

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let hostA: string;
let hostB: string;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  await pb
    .collection("organizations")
    .update(s.A.org, { name: "Rivera Bakery" });
  hostA = String(
    (await pb.collection("org_hosts").getOne(s.base.A.host)).hostname,
  );
  hostB = String(
    (await pb.collection("org_hosts").getOne(s.base.B.host)).hostname,
  );
});

afterAll(async () => {
  await inst?.stop();
});

async function orgRow(id: string) {
  return pb.collection("organizations").getOne(id);
}

async function auditActions(orgId: string): Promise<string[]> {
  const rows = await pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:o} && action ~ 'site.suspen'", {
      o: orgId,
    }),
    sort: "created",
  });
  return rows.map((r) => String(r.action));
}

async function tenantRowCounts(orgId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(TENANT_COLLECTIONS)) {
    const res = await pb.collection(name).getList(1, 1, {
      filter: pb.filter("organization = {:o}", { o: orgId }),
    });
    out[name] = res.totalItems;
  }
  return out;
}

describe("fix-by (D215)", () => {
  it("is three calendar days later at the same Chicago wall time, across DST", () => {
    expect(suspensionFixBy(AT).toISOString()).toBe("2026-10-15T22:00:00.000Z");
    // DST ends Sun 1 Nov 2026: Fri 30 Oct 5:00 pm CDT -> Mon 2 Nov 5:00 pm CST.
    const before = new Date("2026-10-30T22:00:00.000Z");
    expect(suspensionFixBy(before).toISOString()).toBe(
      "2026-11-02T23:00:00.000Z",
    );
  });
});

describe("suspend now and lift (super_admin only)", () => {
  it("refuses a support_agent, suspends for a super_admin and the resolver sees it at once", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffSuspendNow(s.staff.agent, {
        orgId: s.B.org,
        category: "illegal",
        note: "Counterfeit goods",
      }),
    ).rejects.toBeInstanceOf(Forbidden);
    // Warm the resolver cache with "not suspended".
    expect((await resolveOrganization(hostB))?.suspended).toBe(false);
    const before = await tenantRowCounts(s.B.org);

    const transport = captureTransport();
    const inv = recordingInvalidator();
    const r = await staffSuspendNow(
      s.staff.superAdmin,
      {
        orgId: s.B.org,
        category: "illegal",
        note: "Counterfeit goods, staff only",
        now: AT,
      },
      { transport, invalidator: inv },
    );
    expect(r.suspendedAt).toBe(AT.toISOString());
    const row = await orgRow(s.B.org);
    expect(row.suspended_at).not.toBe("");
    expect(row.status).toBe("active");
    expect(row.suspension.mode).toBe("immediate");
    expect(row.suspension.category).toBe("illegal");
    // Cache cleared: the next read already reports it.
    expect((await resolveOrganization(hostB))?.suspended).toBe(true);
    expect(await isHostSuspended(hostB)).toBe(true);
    expect(await isHostSuspended(hostA)).toBe(false);
    expect(inv.tags.length).toBe(2);

    expect(transport.sent.some((m) => m.type === "site.suspended")).toBe(true);
    for (const m of transport.sent) {
      expect(m.text).not.toContain("staff only");
    }
    const audit = await pb.collection("audit_log").getFirstListItem(
      pb.filter("organization = {:o} && action = 'site.suspended'", {
        o: s.B.org,
      }),
    );
    expect(audit.meta).toEqual({ mode: "immediate", category: "illegal" });
    expect(await suspensionStatusFor(s.B.ctx.viewer)).toEqual({
      state: "suspended",
      suspendedAt: AT.toISOString(),
    });

    // Already suspended: refused.
    await expect(
      staffSuspendNow(s.staff.superAdmin, {
        orgId: s.B.org,
        category: "legal_demand",
        note: "again",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);

    // Lift.
    await expect(
      staffLiftSuspension(s.staff.agent, s.B.org),
    ).rejects.toBeInstanceOf(Forbidden);
    const lift = await staffLiftSuspension(s.staff.superAdmin, s.B.org, {
      now: new Date(AT.getTime() + 60 * MIN),
      transport,
    });
    expect(lift.liftedAt).toBeTruthy();
    expect((await resolveOrganization(hostB))?.suspended).toBe(false);
    expect(await suspensionStatusFor(s.B.ctx.owner)).toEqual({ state: "none" });
    expect(
      transport.sent.some((m) => m.type === "site.suspension_lifted"),
    ).toBe(true);
    expect(await auditActions(s.B.org)).toEqual([
      "site.suspended",
      "site.suspension_lifted",
    ]);

    // Invariant 9: every tenant row still exists (the CDS notes only add rows).
    const after = await tenantRowCounts(s.B.org);
    for (const [name, n] of Object.entries(before)) {
      expect(after[name], name).toBeGreaterThanOrEqual(n);
    }
  });

  it("refuses a guideline category for suspend now and an unknown org", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffSuspendNow(s.staff.superAdmin, {
        orgId: s.A.org,
        category: "guideline",
        note: "x",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffSuspendNow(s.staff.superAdmin, {
        orgId: s.A.org,
        category: "illegal",
        note: "",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("two suspends at once: one goes through, one is refused, one offline mail (WR-A06)", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const input = {
      orgId: s.B.org,
      category: "illegal" as const,
      note: "Race check",
      now: AT,
    };
    const results = await Promise.allSettled([
      staffSuspendNow(s.staff.superAdmin, input, { transport }),
      staffSuspendNow(s.staff.superAdmin, input, { transport }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected");
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(
      InvalidInput,
    );
    const owners = new Set(
      transport.sent
        .filter((m) => m.type === "site.suspended")
        .map((m) => m.to),
    );
    expect(
      transport.sent.filter((m) => m.type === "site.suspended").length,
    ).toBe(owners.size);
    await staffLiftSuspension(s.staff.superAdmin, s.B.org, {
      now: new Date(AT.getTime() + MIN),
      transport,
    });
  });
});

describe("notice, auto-suspend and mark fixed", () => {
  it("sends a notice either role can send: fix_by + 3 days, mail, one note, one urgent alert", async (t) => {
    if (!inst) return t.skip();
    const notesBefore = await pb.collection("cds_notes").getList(1, 1, {
      filter: pb.filter("organization = {:o}", { o: s.A.org }),
    });
    const alertsBefore = await pb.collection("alerts").getList(1, 1, {
      filter: pb.filter(
        "organization = {:o} && type = 'site.suspension_notice'",
        {
          o: s.A.org,
        },
      ),
    });
    const transport = captureTransport();
    const r = await staffSendSuspensionNotice(
      s.staff.agent,
      {
        orgId: s.A.org,
        category: "guideline",
        message: "Remove the replica handbags page.",
        note: "Spotted on spot check R-12, staff only",
        now: AT,
      },
      { transport },
    );
    expect(r.fixBy).toBe("2026-10-15T22:00:00.000Z");
    const row = await orgRow(s.A.org);
    expect(row.suspended_at).toBe("");
    expect(row.suspension.mode).toBe("notice");
    expect(row.suspension.fix_by).toBe("2026-10-15T22:00:00.000Z");

    const mail = transport.sent.filter(
      (m) => m.type === "site.suspension_notice",
    );
    expect(mail.length).toBeGreaterThan(0);
    expect(mail[0]!.text).toContain("Remove the replica handbags page.");
    for (const m of transport.sent) {
      expect(m.text).not.toContain("staff only");
    }
    const notes = await pb.collection("cds_notes").getFullList({
      filter: pb.filter("organization = {:o}", { o: s.A.org }),
    });
    expect(notes.length).toBe(notesBefore.totalItems + 1);
    expect(notes.some((n) => n.title === "Hosting rules notice")).toBe(true);
    expect(notes.some((n) => String(n.body).includes("staff only"))).toBe(
      false,
    );
    const alerts = await pb.collection("alerts").getFullList({
      filter: pb.filter(
        "organization = {:o} && type = 'site.suspension_notice'",
        {
          o: s.A.org,
        },
      ),
    });
    expect(alerts.length).toBeGreaterThan(alertsBefore.totalItems);
    expect(new Set(alerts.map((a) => String(a.source_key))).size).toBe(1);
    expect(alerts.every((a) => a.level === "urgent")).toBe(true);

    const status = await suspensionStatusFor(s.A.ctx.editor);
    expect(status).toEqual({
      state: "notice",
      fixBy: "2026-10-15T22:00:00.000Z",
    });
    expect(JSON.stringify(status)).not.toContain("guideline");

    // A second notice while one is open is refused.
    await expect(
      staffSendSuspensionNotice(s.staff.agent, {
        orgId: s.A.org,
        category: "guideline",
        message: "again",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("jobAutoSuspend: nothing before fix_by, suspends after it", async (t) => {
    if (!inst) return t.skip();
    const fixBy = new Date("2026-10-15T22:00:00.000Z");
    const transport = captureTransport();
    expect(
      await jobAutoSuspend(new Date(fixBy.getTime() - MIN), { transport }),
    ).toEqual({ suspended: 0, failed: 0 });
    expect(await isHostSuspended(hostA)).toBe(false);
    expect(
      await jobAutoSuspend(new Date(fixBy.getTime() + MIN), { transport }),
    ).toEqual({ suspended: 1, failed: 0 });
    const row = await orgRow(s.A.org);
    expect(row.suspended_at).not.toBe("");
    expect(row.suspension.mode).toBe("notice_expired");
    expect(row.suspension.by).toBe("system");
    expect(await isHostSuspended(hostA)).toBe(true);
    expect(transport.sent.some((m) => m.type === "site.suspended")).toBe(true);
    const audit = await pb.collection("audit_log").getFirstListItem(
      pb.filter("organization = {:o} && action = 'site.suspended'", {
        o: s.A.org,
      }),
    );
    expect(audit.actor).toBe("");
    // Already suspended: the next run does nothing.
    expect(
      await jobAutoSuspend(new Date(fixBy.getTime() + 2 * MIN), { transport }),
    ).toEqual({ suspended: 0, failed: 0 });
    await staffLiftSuspension(s.staff.superAdmin, s.A.org, { transport });
    expect(await isHostSuspended(hostA)).toBe(false);
  });

  it("after staffMarkFixed the job leaves the site alone", async (t) => {
    if (!inst) return t.skip();
    const now = new Date("2026-10-20T15:00:00.000Z");
    const transport = captureTransport();
    const r = await staffSendSuspensionNotice(
      s.staff.superAdmin,
      {
        orgId: s.A.org,
        category: "dmca",
        message: "Take down the copied photos.",
        now,
      },
      { transport },
    );
    await expect(staffMarkFixed(s.staff.agent, s.B.org)).rejects.toBeInstanceOf(
      InvalidInput,
    );
    const fixed = await staffMarkFixed(s.staff.agent, s.A.org, { now });
    expect(fixed.fixedAt).toBe(now.toISOString());
    expect(await suspensionStatusFor(s.A.ctx.owner)).toEqual({ state: "none" });
    expect(
      await jobAutoSuspend(new Date(Date.parse(r.fixBy!) + MIN), { transport }),
    ).toEqual({ suspended: 0, failed: 0 });
    expect(await isHostSuspended(hostA)).toBe(false);
    expect(await auditActions(s.A.org)).toEqual([
      "site.suspension_notice_sent",
      "site.suspended",
      "site.suspension_lifted",
      "site.suspension_notice_sent",
      "site.suspension_fixed",
    ]);
  });
});

describe("no tenant write path (T-13-17-03)", () => {
  it("a signed-in owner cannot write organizations.suspension or suspended_at directly", async (t) => {
    if (!inst) return t.skip();
    const email = `susp-owner-${Date.now()}@example.com`;
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
      client
        .collection("organizations")
        .update(s.A.org, { suspended_at: "", suspension: null }),
    ).rejects.toBeTruthy();
  });

  it("only staff/suspension.ts writes the suspension fields in @cds/db source", () => {
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
        if (p.replace(/\\/g, "/").endsWith("staff/suspension.ts")) continue;
        const src = readFileSync(p, "utf8");
        if (/\bsuspended_at\s*:|\bsuspension\s*:\s*[{n]/.test(src)) {
          offenders.push(p);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
