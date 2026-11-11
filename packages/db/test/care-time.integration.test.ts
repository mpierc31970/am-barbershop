// 10-27: Care Plan time (BILL-19; CONTEXT A4; D297, D298, D299; invariant 9). Staff log minutes
// into the append-only care_plan_time collection; 60 a month in the business time zone, no
// rollover; past 60 is refused with the locked copy. A lapsed account pauses the Care Plan, so
// nothing can be logged against it (10-27 choice 4). Owner reads are scoped to ctx.orgId
// (T-10-27-03); only staff with care_log may write (T-10-27-02).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { careMonth } from "@cds/core/payments";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { carePlanUsage, logCareTime } from "../src/payments/care-time";
import { bootPb, type PbInstance } from "./pb-harness";
import { staffContext } from "./seeded";

let inst: PbInstance | null = null;
let pb: PocketBase;
let agentCtx: PlatformContext;
let superCtx: PlatformContext;

const tag = () => randomBytes(4).toString("hex");
const at = (iso: string) => ({ now: () => new Date(iso) });
const MID_OCT = at("2026-10-15T17:00:00Z");
const OVER = "Over the hour: send a polish quote (work:quote --kind polish).";
const LAPSED =
  "This site's billing has lapsed: the Care Plan is paused until they pay.";
const NO_CARE = "This site doesn't have the Care Plan.";

async function newOrg(
  account: Record<string, unknown> | null = {
    status: "active",
    care_plan: true,
  },
  role: "owner" | "admin" = "owner",
): Promise<OrgContext> {
  const t = tag();
  const org = await pb.collection("organizations").create({
    name: `Care ${t}`,
    slug: `care-${t}`,
    status: "active",
    path: "standard",
  });
  if (account) {
    await pb.collection("billing_accounts").create({
      organization: org.id,
      provider: "fake",
      customer_id: `cus_${t}`,
      ...account,
    });
  }
  return mintOrgContext({
    orgId: org.id,
    actor: `owner-${t}`,
    role,
    grants: [],
    ip: "127.0.0.1",
  });
}

function asRole(ctx: OrgContext, role: "admin"): OrgContext {
  return mintOrgContext({
    orgId: ctx.orgId,
    actor: ctx.actor,
    role,
    grants: [],
    ip: "127.0.0.1",
  });
}

async function rows(orgId: string) {
  return pb.collection("care_plan_time").getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
  });
}

async function audits(orgId: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("action = 'care_plan.log' && organization = {:org}", {
      org: orgId,
    }),
  });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  agentCtx = await staffContext(inst, "care-agent@cds.test", "support_agent");
  superCtx = await staffContext(inst, "care-super@cds.test", "super_admin");
});

afterAll(async () => {
  await inst?.stop();
});

describe("logCareTime + carePlanUsage (BILL-19)", () => {
  it("25 then 30 logs to 55 of 60 in October; 20 more is refused and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const input = { orgId: ctx.orgId, note: "Swapped the hero photo" };
    expect(
      await logCareTime(agentCtx, { ...input, minutes: 25 }, MID_OCT),
    ).toEqual({ usedMinutes: 25, monthLabel: "October" });
    const usage = await carePlanUsage(ctx, MID_OCT);
    expect(usage).toMatchObject({
      on: true,
      usedMinutes: 25,
      monthLabel: "October",
      resetLabel: "1 Nov",
      totalEntries: 1,
    });
    expect(usage.entries).toEqual([
      { date: "15 Oct", minutes: 25, note: "Swapped the hero photo" },
    ]);
    expect(
      await logCareTime(
        superCtx,
        { ...input, minutes: 30, ticketRef: "T-123" },
        MID_OCT,
      ),
    ).toEqual({ usedMinutes: 55, monthLabel: "October" });
    const err = await logCareTime(
      agentCtx,
      { ...input, minutes: 20 },
      MID_OCT,
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "invalid_input" });
    expect((err as Error).message).toBe(
      `that would make 75 of 60 minutes. ${OVER}`,
    );
    const stored = await rows(ctx.orgId);
    expect(stored.length).toBe(2);
    expect(stored.find((r) => r.minutes === 30)).toMatchObject({
      ticket_ref: "T-123",
      staff: superCtx.actor,
    });
    expect((await audits(ctx.orgId)).length).toBe(2);
  });

  it("each log writes its row and a care_plan.log audit entry together", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    await logCareTime(
      agentCtx,
      { orgId: ctx.orgId, minutes: 15, note: "Menu fix" },
      MID_OCT,
    );
    const [row] = await rows(ctx.orgId);
    const [audit] = await audits(ctx.orgId);
    expect(row).toMatchObject({ minutes: 15, staff: agentCtx.actor });
    expect(audit).toMatchObject({
      target_collection: "care_plan_time",
      target_id: row!.id,
      actor: agentCtx.actor,
    });
    expect(audit!.meta).toMatchObject({ minutes: 15, usedMinutes: 15 });
  });

  it("the month follows the business time zone and never rolls over", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const base = { orgId: ctx.orgId, note: "Edit" };
    await logCareTime(
      agentCtx,
      { ...base, minutes: 50 },
      at("2026-10-31T20:00:00Z"),
    );
    // 04:30Z on 1 Nov is still 31 Oct in Chicago: October reaches exactly 60.
    expect(
      await logCareTime(
        agentCtx,
        { ...base, minutes: 10 },
        at("2026-11-01T04:30:00Z"),
      ),
    ).toEqual({ usedMinutes: 60, monthLabel: "October" });
    // 06:00Z is 1 Nov in Chicago: November starts at 0.
    expect(
      await logCareTime(
        agentCtx,
        { ...base, minutes: 30 },
        at("2026-11-01T06:00:00Z"),
      ),
    ).toEqual({ usedMinutes: 30, monthLabel: "November" });
    const nov = await carePlanUsage(ctx, at("2026-11-02T12:00:00Z"));
    expect(nov).toMatchObject({
      usedMinutes: 30,
      monthLabel: "November",
      resetLabel: "1 Dec",
      totalEntries: 1,
    });
  });

  it("shows up to 5 entries, newest first, with the month's total count", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    for (let d = 1; d <= 6; d++) {
      const day = String(d + 1).padStart(2, "0");
      await logCareTime(
        agentCtx,
        { orgId: ctx.orgId, minutes: 5, note: `Entry ${d}` },
        at(`2026-10-${day}T17:00:00Z`),
      );
    }
    const usage = await carePlanUsage(ctx, MID_OCT);
    expect(usage.usedMinutes).toBe(30);
    expect(usage.totalEntries).toBe(6);
    expect(usage.entries.map((e) => e.note)).toEqual([
      "Entry 6",
      "Entry 5",
      "Entry 4",
      "Entry 3",
      "Entry 2",
    ]);
    expect(usage.entries[0]!.date).toBe("7 Oct");
  });

  it("a site without the Care Plan is refused (flag off, or no account)", async (t) => {
    if (!inst) return t.skip();
    for (const account of [{ status: "active", care_plan: false }, null]) {
      const ctx = await newOrg(account);
      await expect(
        logCareTime(
          agentCtx,
          { orgId: ctx.orgId, minutes: 10, note: "x" },
          MID_OCT,
        ),
      ).rejects.toThrow(NO_CARE);
      expect((await rows(ctx.orgId)).length).toBe(0);
      expect(await carePlanUsage(ctx, MID_OCT)).toMatchObject({
        on: false,
        usedMinutes: 0,
        entries: [],
        totalEntries: 0,
      });
    }
  });

  it("lapsed is refused with no row and no audit; past_due still logs (choice 4)", async (t) => {
    if (!inst) return t.skip();
    const lapsed = await newOrg({ status: "lapsed", care_plan: true });
    await expect(
      logCareTime(
        agentCtx,
        { orgId: lapsed.orgId, minutes: 10, note: "x" },
        MID_OCT,
      ),
    ).rejects.toThrow(LAPSED);
    expect((await rows(lapsed.orgId)).length).toBe(0);
    expect((await audits(lapsed.orgId)).length).toBe(0);
    expect((await carePlanUsage(lapsed, MID_OCT)).on).toBe(false);

    const canceled = await newOrg({ status: "canceled", care_plan: true });
    await expect(
      logCareTime(
        agentCtx,
        { orgId: canceled.orgId, minutes: 10, note: "x" },
        MID_OCT,
      ),
    ).rejects.toThrow(LAPSED);

    const pastDue = await newOrg({ status: "past_due", care_plan: true });
    expect(
      await logCareTime(
        agentCtx,
        { orgId: pastDue.orgId, minutes: 10, note: "x" },
        MID_OCT,
      ),
    ).toEqual({ usedMinutes: 10, monthLabel: "October" });
  });

  it("validates minutes (1-600 whole), note (1-500) and ticket ref; unknown org is NotFound", async (t) => {
    if (!inst) return t.skip();
    const ctx = await newOrg();
    const bad = [
      { minutes: 0, note: "x" },
      { minutes: 601, note: "x" },
      { minutes: 1.5, note: "x" },
      { minutes: 10, note: "   " },
      { minutes: 10, note: "x".repeat(501) },
      { minutes: 10, note: "x", ticketRef: "bad ref!" },
    ];
    for (const b of bad) {
      await expect(
        logCareTime(agentCtx, { orgId: ctx.orgId, ...b }, MID_OCT),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(
      logCareTime(
        agentCtx,
        { orgId: "abcdefghijklmno", minutes: 10, note: "x" },
        MID_OCT,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await rows(ctx.orgId)).length).toBe(0);
  });

  it("an owner context cannot log; admin cannot read usage; org B never sees org A", async (t) => {
    if (!inst) return t.skip();
    const a = await newOrg();
    const b = await newOrg();
    await expect(
      logCareTime(
        a as unknown as PlatformContext,
        { orgId: a.orgId, minutes: 10, note: "x" },
        MID_OCT,
      ),
    ).rejects.toThrow();
    expect((await rows(a.orgId)).length).toBe(0);
    await logCareTime(
      agentCtx,
      { orgId: a.orgId, minutes: 20, note: "A only" },
      MID_OCT,
    );
    await expect(
      carePlanUsage(asRole(a, "admin"), MID_OCT),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await carePlanUsage(b, MID_OCT)).toMatchObject({
      on: true,
      usedMinutes: 0,
      entries: [],
      totalEntries: 0,
    });
  });
});

// ------------------------------------------------------------------ care:log CLI (Task 2)

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const SCRIPT = join(PKG_DIR, "scripts", "care-log.ts");
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  pathToFileURL(join(PKG_DIR, "scripts", "register-ts.mjs")).href,
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function childEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CDS_ENV;
  return env as NodeJS.ProcessEnv;
}

function runQuick(args: string[]) {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: childEnv(),
    timeout: 60_000,
  });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

async function latestOtp(userId: string, after: number): Promise<string> {
  const re = new RegExp(`OTP_STANDIN users ${userId} \\w+ (\\d{6})`, "g");
  for (let i = 0; i < 200; i++) {
    const all = [...inst!.stdout().slice(after).matchAll(re)];
    if (all.length > 0) return all[all.length - 1]![1]!;
    await sleep(50);
  }
  throw new Error("no OTP_STANDIN line");
}

type Staff = { id: string; email: string; password: string };

async function seedStaff(): Promise<Staff> {
  const email = `care-cli-${tag()}@cds.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: "support_agent",
  });
  return { id: rec.id, email, password };
}

async function runCli(
  who: Staff,
  args: string[],
): Promise<{ status: number | null; output: string; code: string }> {
  const mark = inst!.stdout().length;
  const child = spawn(process.execPath, [...NODE_FLAGS, SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (c: Buffer) => (output += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (output += c.toString("utf8")));
  const exited = new Promise<number | null>((done) =>
    child.once("close", (code) => done(code)),
  );
  child.stdin.write(`${who.email}\n${who.password}\n`);
  let code = "";
  for (let i = 0; i < 1200; i++) {
    if (output.includes("Enter it below") || child.exitCode !== null) break;
    await sleep(50);
  }
  if (output.includes("Enter it below")) {
    code = await latestOtp(who.id, mark);
    child.stdin.write(`${code}\n`);
  }
  child.stdin.end();
  return { status: await exited, output, code };
}

describe("care:log CLI", () => {
  it("--help exits 0; bad --org, --minutes or --note exit 1 before any sign-in", (t) => {
    if (!inst) return t.skip();
    const help = runQuick(["--help"]);
    expect(help.status).toBe(0);
    expect(help.output).toContain("care:log");
    const org = "abcdefghijklmno";
    const cases: [string[], string][] = [
      [["--minutes", "30", "--note", "x"], "--org <org-id> is required"],
      [
        ["--org", "BAD", "--minutes", "30", "--note", "x"],
        "--org is not a valid organization id",
      ],
      [["--org", org, "--minutes", "1.5", "--note", "x"], "whole number"],
      [["--org", org, "--minutes", "0", "--note", "x"], "whole number"],
      [["--org", org, "--minutes", "601", "--note", "x"], "whole number"],
      [["--org", org, "--minutes", "30", "--note", "  "], "--note must be"],
      [["--org", org, "--minutes", "30"], "--note"],
    ];
    for (const [args, msg] of cases) {
      const r = runQuick(args);
      expect(r.status).toBe(1);
      expect(r.output).toContain(msg);
      expect(r.output).not.toContain("Staff email");
    }
  });

  it("logs, refuses over the hour and lapsed with exit 1, dry run writes nothing", async (t) => {
    if (!inst) return t.skip();
    const who = await seedStaff();
    const month = careMonth(new Date()).label;
    const ctx = await newOrg();
    await logCareTime(agentCtx, { orgId: ctx.orgId, minutes: 25, note: "x" });

    const dry = await runCli(who, [
      "--org",
      ctx.orgId,
      "--minutes",
      "30",
      "--note",
      "Fixed the footer",
      "--dry-run",
    ]);
    expect(dry.status).toBe(0);
    expect(dry.output).toContain("DRY RUN would log 30 min");
    expect((await rows(ctx.orgId)).length).toBe(1);

    const ok = await runCli(who, [
      "--org",
      ctx.orgId,
      "--minutes",
      "30",
      "--note",
      "Fixed the footer",
      "--ticket",
      "T-9",
    ]);
    expect(ok.status).toBe(0);
    expect(ok.output).toContain(
      `Logged 30 min. ${month}: 55 of 60 minutes used.`,
    );
    expect(ok.output).not.toContain(who.password);
    if (ok.code) expect(ok.output).not.toContain(ok.code);

    const over = await runCli(who, [
      "--org",
      ctx.orgId,
      "--minutes",
      "20",
      "--note",
      "One more",
    ]);
    expect(over.status).toBe(1);
    expect(over.output).toContain(
      `Refused: that would make 75 of 60 minutes. ${OVER}`,
    );
    expect((await rows(ctx.orgId)).length).toBe(2);

    const lapsed = await newOrg({ status: "lapsed", care_plan: true });
    const refused = await runCli(who, [
      "--org",
      lapsed.orgId,
      "--minutes",
      "10",
      "--note",
      "x",
    ]);
    expect(refused.status).toBe(1);
    expect(refused.output).toContain(`Refused: ${LAPSED}`);
    expect((await rows(lapsed.orgId)).length).toBe(0);
  });
});
