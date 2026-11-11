// ADDON-09 staff path: the addons:install CLI against a throwaway PocketBase 0.39.11 and a
// temp CDS_STORAGE_DIR (CONTEXT A2-Q4; T-05-41, T-05-42). Spawned with the same flags as the
// root npm script (Node type stripping + register-ts.mjs), not via npm. Output must never
// carry secrets.
// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const REGISTER = pathToFileURL(
  join(PKG_DIR, "scripts", "register-ts.mjs"),
).href;
const SCRIPT = join(PKG_DIR, "scripts", "addons-install.ts");
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  REGISTER,
];

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
const staff: Record<string, { id: string; email: string; password: string }> =
  {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function childEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CDS_STORAGE_DIR: storageDir,
  };
  delete env.CDS_ENV;
  for (const k of Object.keys(env)) if (k.startsWith("WASABI_")) delete env[k];
  return env as NodeJS.ProcessEnv;
}

/** Runs without prompts (help, argument errors, dry run). */
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
    const out = inst!.stdout().slice(after);
    const all = [...out.matchAll(re)];
    if (all.length > 0) return all[all.length - 1]![1]!;
    await sleep(50);
  }
  throw new Error("no OTP_STANDIN line");
}

/** Run addons:install, answering the prompts like an operator would. */
async function runCli(
  who: { id: string; email: string; password: string },
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
  const exited = new Promise<number | null>((resolve) =>
    child.once("close", (code) => resolve(code)),
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
  const status = await exited;
  return { status, output, code };
}

async function seedStaff(
  key: string,
  role: "super_admin" | "support_agent",
): Promise<void> {
  const email = `addons-${key}@cds.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: role,
  });
  staff[key] = { id: rec.id, email, password };
}

async function addonRow(orgId: string) {
  return pb
    .collection("org_addons")
    .getFirstListItem(
      pb.filter("organization = {:o} && addon = 'testimonials'", { o: orgId }),
    );
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-addons-cli-"));
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  await seedStaff("super", "super_admin");
  await seedStaff("agent", "support_agent");
});

afterAll(async () => {
  await inst?.stop();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

const ORG = "abcdefghijklmno";

describe("addons:install CLI", () => {
  it("--help exits 0 and prints usage", () => {
    const { status, output } = runQuick(["--help"]);
    expect(status).toBe(0);
    expect(output).toContain("addons:install");
    expect(output).toContain("--uninstall");
    expect(output).toContain("--dry-run");
  });

  it("refuses an unknown argument", () => {
    const { status, output } = runQuick([
      "--org",
      ORG,
      "--addon",
      "testimonials",
      "--reason",
      "x",
      "--force",
    ]);
    expect(status).toBe(1);
    expect(output).toContain("FAIL unknown argument --force");
  });

  it("--dry-run with an unknown add-on fails", () => {
    const { status, output } = runQuick([
      "--org",
      ORG,
      "--addon",
      "no-such-addon",
      "--reason",
      "test",
      "--dry-run",
    ]);
    expect(status).toBe(1);
    expect(output).toContain("FAIL unknown add-on");
  });

  it("--dry-run testimonials passes without signing in, for add and remove", () => {
    const add = runQuick([
      "--org",
      ORG,
      "--addon",
      "testimonials",
      "--reason",
      "Customer asked",
      "--dry-run",
    ]);
    expect(add.status).toBe(0);
    expect(add.output).toContain(
      `DRY RUN would add testimonials for org ${ORG}`,
    );
    expect(add.output).not.toContain("Staff email");
    const remove = runQuick([
      "--org",
      ORG,
      "--addon=testimonials",
      "--reason=Customer asked",
      "--uninstall",
      "--dry-run",
    ]);
    expect(remove.status).toBe(0);
    expect(remove.output).toContain(
      `DRY RUN would remove testimonials for org ${ORG}`,
    );
  });

  it("a missing or empty --reason fails", () => {
    const missing = runQuick([
      "--org",
      ORG,
      "--addon",
      "testimonials",
      "--dry-run",
    ]);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain("FAIL --reason");
    const empty = runQuick([
      "--org",
      ORG,
      "--addon",
      "testimonials",
      "--reason",
      "   ",
      "--dry-run",
    ]);
    expect(empty.status).toBe(1);
    expect(empty.output).toContain("FAIL --reason must be 1-500 characters");
  });

  it("a bad org id fails before any prompt", () => {
    const { status, output } = runQuick([
      "--org",
      "../etc",
      "--addon",
      "testimonials",
      "--reason",
      "x",
    ]);
    expect(status).toBe(1);
    expect(output).toContain("FAIL --org is not a valid organization id");
  });

  it("a super_admin adds Testimonials for org A, then --uninstall removes it (audited)", async (t) => {
    if (!inst) return t.skip();
    const who = staff.super!;
    const reason = "Onboarding call 2026-09-28";
    const added = await runCli(who, [
      "--org",
      seed.A.org,
      "--addon",
      "testimonials",
      "--reason",
      reason,
    ]);
    expect(added.output).toContain(
      `PASS added testimonials for org ${seed.A.org} (installed)`,
    );
    expect(added.status).toBe(0);
    const row = await addonRow(seed.A.org);
    expect(row.status).toBe("active");
    expect(row.source).toBe("staff");
    expect(added.output).not.toContain(who.password);
    expect(added.code).toMatch(/^\d{6}$/);
    expect(added.output).not.toContain(added.code);
    expect(added.output).not.toContain(inst.password);

    const removed = await runCli(who, [
      "--org",
      seed.A.org,
      "--addon",
      "testimonials",
      "--reason",
      reason,
      "--uninstall",
    ]);
    expect(removed.output).toContain(
      `PASS removed testimonials for org ${seed.A.org} (removed)`,
    );
    expect(removed.status).toBe(0);
    const after = await addonRow(seed.A.org);
    expect(after.status).toBe("disabled");
    expect(after.disabled_reason).toBe("staff");
    // Retained: the fixture testimonial is still there (invariant 9).
    expect(
      (await pb.collection("testimonials").getOne(seed.A.testimonial))
        .organization,
    ).toBe(seed.A.org);

    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && actor = {:a}", {
        o: seed.A.org,
        a: who.id,
      }),
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audits.map((a) => a.meta))).toContain(reason);
  });

  it("a support agent is refused (FAIL forbidden) and nothing is installed", async (t) => {
    if (!inst) return t.skip();
    const { status, output } = await runCli(staff.agent!, [
      "--org",
      seed.B.org,
      "--addon",
      "testimonials",
      "--reason",
      "Trying",
    ]);
    expect(status).toBe(1);
    expect(output).toContain("FAIL forbidden");
    expect(output).not.toContain(staff.agent!.password);
    const rows = await pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:o} && addon = 'testimonials'", {
        o: seed.B.org,
      }),
    });
    expect(rows).toEqual([]);
  });
});
