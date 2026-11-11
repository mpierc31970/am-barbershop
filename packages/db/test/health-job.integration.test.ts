// 13-44 (STAFF-13, STAFF-14, D154, P13-P19; T-13-44-02, T-13-44-03): the health view and the
// once-per-incident staff alert, on the real PocketBase binary. A support heartbeat 5 h old is
// critical in the view; the first evaluation sends one email, the second none, a fresh
// heartbeat sends one "Resolved" email and removes the incident key; warn -> critical sends
// exactly one more; a restore rehearsed 100 days ago is a warning; premium rows come from the
// caller's manifests (fixture -> one row for the live org, never the demo org; real registry ->
// none); a member context is refused.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidContext } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_PREMIUM_OK } from "../../core/src/addons/__fixtures__/manifests";
import { resetClientForTests, superuser } from "../src/client";
import type { PlatformContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import { HEALTH_LOCK_KEY, runHealthJob } from "../src/jobs/health";
import { notDeployedFailsafe } from "../src/staff/failsafe";
import {
  HEALTH_INCIDENT_PREFIX,
  jobEvaluateHealth,
  staffHealthView,
} from "../src/staff/health";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import { staffContext, staffSessionFor } from "./seeded";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = new Date("2026-10-16T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const iso = (d: Date) => d.toISOString();

let inst: PbInstance | null = null;
let pb: PocketBase;
let agentCtx: PlatformContext;
let orgs: TwoOrgs;
let liveOrg = "";
let storageDir = "";
const savedStorageDir = process.env.CDS_STORAGE_DIR;
const savedAlert = process.env.CDS_STAFF_ALERT_EMAIL;

async function setMeta(key: string, value: string): Promise<void> {
  try {
    const row = await pb
      .collection("platform_meta")
      .getFirstListItem(pb.filter("key = {:key}", { key }));
    await pb.collection("platform_meta").update(row.id, { value });
  } catch {
    await pb.collection("platform_meta").create({ key, value });
  }
}

async function metaValue(key: string): Promise<string | null> {
  try {
    const row = await pb
      .collection("platform_meta")
      .getFirstListItem(pb.filter("key = {:key}", { key }));
    return String(row.value ?? "");
  } catch {
    return null;
  }
}

/** A support heartbeat `ageMs` before `now` with a clean last run. */
async function supportHeartbeat(now: Date, ageMs: number): Promise<void> {
  await setMeta(
    "job:support:last_success",
    iso(new Date(now.getTime() - ageMs)),
  );
  await setMeta(
    "job:support:last_counts",
    JSON.stringify({ slaMissedOpen: 0, failedSteps: [], openWindows: [] }),
  );
}

function supportMail(t: ReturnType<typeof captureTransport>) {
  return t.sent.filter((m) => m.subject.includes("Support job"));
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-health-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = "alerts@cds.test";
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  orgs = await seedTwoOrgs(pb);
  agentCtx = await staffContext(inst, "health-agent@cds.test", "support_agent");
  liveOrg = (
    await pb.collection("organizations").create({
      name: "Rivera Bakery",
      slug: "health-rivera",
      status: "active",
      stage: "live",
    })
  ).id;
  const demoOrg = (
    await pb.collection("organizations").create({
      name: "Bella's Salon",
      slug: "health-demo",
      status: "active",
      stage: "live",
      demo: true,
    })
  ).id;
  for (const org of [liveOrg, demoOrg]) {
    await pb.collection("org_addons").create({
      organization: org,
      addon: FIXTURE_PREMIUM_OK.slug,
      status: "active",
      source: "staff",
    });
  }
  await setMeta(
    "backup:restore_rehearsed_at",
    iso(new Date(T0.getTime() - DAY)),
  );
}, 120_000);

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  if (savedAlert === undefined) delete process.env.CDS_STAFF_ALERT_EMAIL;
  else process.env.CDS_STAFF_ALERT_EMAIL = savedAlert;
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

describe("staffHealthView + jobEvaluateHealth (13-44)", () => {
  it("one email when a check opens, none while open, one 'Resolved' when it closes", async () => {
    if (!inst) return;
    const key = `${HEALTH_INCIDENT_PREFIX}job-support`;
    const t = captureTransport();

    const now1 = at(0);
    await supportHeartbeat(now1, 5 * HOUR);
    const view = await staffHealthView(agentCtx, { now: now1 });
    const row = view.jobs.find((j) => j.id === "job-support")!;
    expect(row).toMatchObject({
      job: "support:run",
      level: "critical",
      warningText: "> 2 h, SLA missed or failed steps",
      criticalText: "> 4 h, or a service window open > 24 h",
      schedule: "hourly",
    });
    expect(row.reading).toBe("Last success 5 h ago");
    expect(view.alertEmail).toBe("a•••@cds.test");

    const r1 = await jobEvaluateHealth(now1, { transport: t });
    expect(r1.checks).toBeGreaterThan(10);
    expect(supportMail(t)).toHaveLength(1);
    const open = supportMail(t)[0]!;
    expect(open.to).toBe("alerts@cds.test");
    expect(open.subject).toBe("Critical: Support job Last success 5 h ago");
    // Counts and ages only: never a tenant name or email.
    expect(open.text).not.toContain("Rivera");
    expect(open.text).toContain("/staff/health?tab=jobs");
    const stored = JSON.parse((await metaValue(key))!) as {
      level: string;
      opened_at: string;
    };
    expect(stored).toEqual({ level: "critical", opened_at: iso(now1) });

    const view2 = await staffHealthView(agentCtx, { now: now1 });
    expect(view2.jobs.find((j) => j.id === "job-support")!.since).toBe(
      iso(now1),
    );

    const now2 = at(5 * MIN);
    await jobEvaluateHealth(now2, { transport: t });
    expect(supportMail(t)).toHaveLength(1);

    const now3 = at(80 * MIN);
    await supportHeartbeat(now3, MIN);
    const r3 = await jobEvaluateHealth(now3, { transport: t });
    expect(r3.closed).toBeGreaterThanOrEqual(1);
    const mails = supportMail(t);
    expect(mails).toHaveLength(2);
    expect(mails[1]!.subject).toBe("Resolved: Support job");
    expect(mails[1]!.text).toContain("Back to normal after 1 h 20 min");
    expect(await metaValue(key)).toBeNull();
  });

  it("warn -> critical sends exactly one more email; a dry run sends and writes nothing", async () => {
    if (!inst) return;
    const key = `${HEALTH_INCIDENT_PREFIX}job-support`;
    const t = captureTransport();
    const now1 = at(2 * DAY);
    await supportHeartbeat(now1, 3 * HOUR);

    const dry = await jobEvaluateHealth(now1, { transport: t, dryRun: true });
    expect(dry.opened).toBeGreaterThanOrEqual(1);
    expect(t.sent).toHaveLength(0);
    expect(await metaValue(key)).toBeNull();

    await jobEvaluateHealth(now1, { transport: t });
    expect(supportMail(t)).toHaveLength(1);
    expect(supportMail(t)[0]!.subject).toMatch(/^Warning: Support job/);
    expect(JSON.parse((await metaValue(key))!)).toMatchObject({
      level: "warn",
    });

    const now2 = at(2 * DAY + 2 * HOUR);
    const r2 = await jobEvaluateHealth(now2, { transport: t });
    expect(r2.escalated).toBe(1);
    expect(supportMail(t)).toHaveLength(2);
    expect(supportMail(t)[1]!.subject).toMatch(/^Critical: Support job/);
    expect(JSON.parse((await metaValue(key))!)).toEqual({
      level: "critical",
      opened_at: iso(now1),
    });

    await jobEvaluateHealth(at(2 * DAY + 3 * HOUR), { transport: t });
    expect(supportMail(t)).toHaveLength(2);

    // Close it again for the next tests.
    const now4 = at(2 * DAY + 4 * HOUR);
    await supportHeartbeat(now4, MIN);
    await jobEvaluateHealth(now4, { transport: t });
    expect(await metaValue(key)).toBeNull();
  });

  it("no staff alert address: skipped, the incident is still recorded", async () => {
    if (!inst) return;
    const key = `${HEALTH_INCIDENT_PREFIX}job-support`;
    const t = captureTransport();
    const now = at(4 * DAY);
    await supportHeartbeat(now, 5 * HOUR);
    const prevSupport = process.env.CDS_SUPPORT_EMAIL;
    process.env.CDS_STAFF_ALERT_EMAIL = "";
    process.env.CDS_SUPPORT_EMAIL = "";
    try {
      const r = await jobEvaluateHealth(now, { transport: t });
      expect(r.emailSkipped).toBeGreaterThanOrEqual(1);
      expect(t.sent).toHaveLength(0);
      expect(await metaValue(key)).not.toBeNull();
    } finally {
      process.env.CDS_STAFF_ALERT_EMAIL = "alerts@cds.test";
      if (prevSupport === undefined) delete process.env.CDS_SUPPORT_EMAIL;
      else process.env.CDS_SUPPORT_EMAIL = prevSupport;
    }
    await supportHeartbeat(now, MIN);
    await jobEvaluateHealth(now, { transport: captureTransport() });
    expect(await metaValue(key)).toBeNull();
  });

  it("restore rehearsed 100 days ago is a warning", async () => {
    if (!inst) return;
    const now = at(0);
    await setMeta(
      "backup:restore_rehearsed_at",
      iso(new Date(now.getTime() - 100 * DAY)),
    );
    try {
      const view = await staffHealthView(agentCtx, { now });
      expect(view.restore).toMatchObject({ days: 100, level: "warn" });
      expect(view.backups.find((b) => b.id === "restore")).toMatchObject({
        level: "warn",
        reading: "Last rehearsed 100 days ago",
        threshold: "warn > 90 days",
      });
      expect(view.checks.find((c) => c.id === "restore-rehearsal")!.level).toBe(
        "warn",
      );
    } finally {
      await setMeta(
        "backup:restore_rehearsed_at",
        iso(new Date(now.getTime() - DAY)),
      );
    }
  });

  it("stand-ins read as words with level none; premium rows come from the manifests", async () => {
    if (!inst) return;
    const view = await staffHealthView(agentCtx, {
      now: at(0),
      manifests: [FIXTURE_PREMIUM_OK],
    });
    expect(view.components.find((c) => c.id === "email")).toMatchObject({
      level: "none",
      reading: "Email: logged (stand-in)",
    });
    expect(view.components.find((c) => c.id === "pocketbase")!.level).toBe(
      "ok",
    );
    expect(view.failsafe).toMatchObject({
      deployed: false,
      level: "none",
      reading: "Capture service: not deployed (stand-in)",
    });
    expect(view.premium).toHaveLength(1);
    expect(view.premium[0]).toMatchObject({
      orgId: liveOrg,
      business: "Rivera Bakery",
      addon: FIXTURE_PREMIUM_OK.slug,
      passing: null,
      level: "none",
    });

    const real = await staffHealthView(agentCtx, {
      now: at(0),
      manifests: ADDON_REGISTRY.list(),
    });
    expect(real.premium).toEqual([]);
  });

  it("a member context is refused", async () => {
    if (!inst) return;
    await expect(
      staffHealthView(orgs.ctxA as unknown as PlatformContext),
    ).rejects.toBeInstanceOf(InvalidContext);
  });
});

describe("runHealthJob (13-44)", () => {
  it("a held lock reads busy and writes nothing", async () => {
    if (!inst) return;
    const now = new Date();
    const lock = await pb
      .collection("platform_meta")
      .create({ key: HEALTH_LOCK_KEY, value: `other ${now.toISOString()}` });
    try {
      const res = await runHealthJob({
        now,
        transport: captureTransport(),
        failsafe: notDeployedFailsafe,
      });
      expect(res.busy).toBe(true);
      expect(res.checks).toBe(0);
      expect(await metaValue("job:health:last_counts")).toBeNull();
    } finally {
      await pb.collection("platform_meta").delete(lock.id);
    }
  });

  it("dry run counts, then a real run checks, pulls (stand-in: 0), prunes and beats", async () => {
    if (!inst) return;
    const s = await staffSessionFor(inst, "support_agent");
    const later = new Date(Date.now() + 31 * DAY);
    const t = captureTransport();

    const dry = await runHealthJob({
      now: later,
      dryRun: true,
      transport: t,
      failsafe: notDeployedFailsafe,
    });
    expect(dry).toMatchObject({ dryRun: true, busy: false, failedSteps: [] });
    expect(dry.checks).toBeGreaterThan(10);
    expect(dry.sessionsPruned).toBeGreaterThanOrEqual(1);
    expect(t.sent).toHaveLength(0);
    expect(await metaValue("job:health:last_success")).toBeNull();
    expect(await metaValue("job:health:last_counts")).toBeNull();
    await expect(
      pb.collection("staff_sessions").getOne(s.sessionId),
    ).resolves.toBeTruthy();

    const res = await runHealthJob({
      now: later,
      transport: t,
      failsafe: notDeployedFailsafe,
    });
    expect(res).toMatchObject({
      dryRun: false,
      busy: false,
      failsafePulled: 0,
      failedSteps: [],
    });
    expect(res.sessionsPruned).toBeGreaterThanOrEqual(1);
    await expect(
      pb.collection("staff_sessions").getOne(s.sessionId),
    ).rejects.toThrow();
    expect(await metaValue("job:health:last_success")).toBe(
      later.toISOString(),
    );
    const counts = JSON.parse(
      (await metaValue("job:health:last_counts"))!,
    ) as Record<string, unknown>;
    expect(Object.keys(counts).sort()).toEqual(
      [
        "dryRun",
        "busy",
        "checks",
        "opened",
        "escalated",
        "closed",
        "emailsSent",
        "emailSkipped",
        "failsafePulled",
        "sessionsPruned",
        "failedSteps",
      ].sort(),
    );
    // Counts only: no org id, name or email.
    const raw = (await metaValue("job:health:last_counts"))!;
    expect(raw).not.toContain("@");
    expect(raw).not.toContain(liveOrg);
    // The lock is released.
    expect(await metaValue(HEALTH_LOCK_KEY)).toBeNull();
  });
});
