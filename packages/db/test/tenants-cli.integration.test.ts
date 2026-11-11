// TEN-12 tenants:export / tenants:restore CLIs against a throwaway PocketBase 0.39.11 and a
// temp CDS_STORAGE_DIR. The scripts are spawned with the same flags as the root npm scripts
// (Node type stripping + register-ts.mjs), not via npm. Output must never carry secrets.
// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { tenantExportKey } from "../src/storage/keys";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const REGISTER = pathToFileURL(
  join(PKG_DIR, "scripts", "register-ts.mjs"),
).href;
const EXPORT_SCRIPT = join(PKG_DIR, "scripts", "tenants-export.ts");
const RESTORE_SCRIPT = join(PKG_DIR, "scripts", "tenants-restore.ts");
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

function childEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CDS_STORAGE_DIR: storageDir,
  };
  delete env.CDS_ENV;
  for (const k of Object.keys(env)) if (k.startsWith("WASABI_")) delete env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env as NodeJS.ProcessEnv;
}

function runExport(args: string[], env = childEnv()) {
  const r = spawnSync(
    process.execPath,
    [...NODE_FLAGS, EXPORT_SCRIPT, ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env,
      timeout: 60_000,
    },
  );
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name));
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

/** Run tenants:restore, answering the prompts like an operator would. */
async function runRestore(
  who: { id: string; email: string; password: string },
  args: string[],
): Promise<{ status: number | null; output: string; code: string }> {
  const mark = inst!.stdout().length;
  const child = spawn(
    process.execPath,
    [...NODE_FLAGS, RESTORE_SCRIPT, ...args],
    { cwd: REPO_ROOT, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (c: Buffer) => (output += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (output += c.toString("utf8")));
  const exited = new Promise<number | null>((resolve) =>
    // "close", not "exit": stdout can still be flushing after exit, and a FAIL line read
    // before it lands was the full-suite flake (deferred-items 03-03, 03-07).
    child.once("close", (code) => resolve(code)),
  );
  child.stdin.write(`${who.email}\n${who.password}\n`);
  let code = "";
  // Up to 60s for the prompt: under full-suite load the CLI's start-up is slow.
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
  const email = `${key}@cds.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: role,
  });
  staff[key] = { id: rec.id, email, password };
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  storageDir = mkdtempSync(join(tmpdir(), "cds-cli-store-"));
  await seedStaff("super", "super_admin");
  await seedStaff("agent", "support_agent");
});

afterAll(async () => {
  await inst?.stop();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

describe("tenants:export CLI", () => {
  it("--help exits 0 and prints usage", () => {
    const { status, output } = runExport(["--help"]);
    expect(status).toBe(0);
    expect(output).toContain("tenants:export");
    expect(output).toContain("--dry-run");
  });

  it("missing PB_URL fails naming the variable, never a value", async (t) => {
    if (!inst) return t.skip();
    const { status, output } = runExport([], childEnv({ PB_URL: undefined }));
    expect(status).toBe(1);
    expect(output).toContain("FAIL PB_URL is not set");
    expect(output).not.toContain(inst.password);
  });

  it("--dry-run lists every org and its target key without writing", async (t) => {
    if (!inst) return t.skip();
    const { status, output } = runExport(["--dry-run"]);
    expect(status).toBe(0);
    for (const org of [seed.A.org, seed.B.org]) {
      expect(output).toMatch(
        new RegExp(`DRY RUN ${org} -> dev/tenants/${org}/exports/`),
      );
    }
    expect(listFiles(storageDir)).toEqual([]);
  });

  it("exports every org, prunes old exports and never prints the password", async (t) => {
    if (!inst) return t.skip();
    const old = tenantExportKey(
      seed.A.org,
      new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
    );
    const oldPath = join(storageDir, ...old.split("/"));
    spawnSync(process.execPath, [
      "-e",
      `const f=require("fs");f.mkdirSync(require("path").dirname(process.argv[1]),{recursive:true});f.writeFileSync(process.argv[1],"{}")`,
      oldPath,
    ]);
    expect(existsSync(oldPath)).toBe(true);

    const { status, output } = runExport([]);
    expect(status).toBe(0);
    for (const org of [seed.A.org, seed.B.org]) {
      const m = new RegExp(`PASS exported ${org} -> (\\S+)`).exec(output);
      expect(m).not.toBeNull();
      expect(existsSync(join(storageDir, ...m![1]!.split("/")))).toBe(true);
    }
    expect(output).toContain("PASS pruned 1");
    expect(existsSync(oldPath)).toBe(false);
    expect(output).not.toContain(inst.password);
  });
});

describe("tenants:restore CLI", () => {
  it("--help exits 0", () => {
    const r = spawnSync(
      process.execPath,
      [...NODE_FLAGS, RESTORE_SCRIPT, "--help"],
      { cwd: REPO_ROOT, encoding: "utf8", env: childEnv(), timeout: 60_000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--org");
  });

  it("restores one org after a super_admin MFA sign-in", async (t) => {
    if (!inst) return t.skip();
    const exp = runExport([]);
    const key = new RegExp(`PASS exported ${seed.A.org} -> (\\S+)`).exec(
      exp.output,
    )![1]!;
    await pb
      .collection("organizations")
      .update(seed.A.org, { name: "Renamed by test" });
    const who = staff.super!;
    const { status, output, code } = await runRestore(who, [
      "--org",
      seed.A.org,
      "--key",
      key,
    ]);
    expect(output).toContain("PASS restored");
    expect(status).toBe(0);
    expect((await pb.collection("organizations").getOne(seed.A.org)).name).toBe(
      "Org A",
    );
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'tenant.restore' && actor = {:a}",
        { o: seed.A.org, a: who.id },
      ),
    });
    expect(rows).toHaveLength(1);
    expect(output).not.toContain(who.password);
    expect(code).toMatch(/^\d{6}$/);
    expect(output).not.toContain(code);
    expect(output).not.toContain(inst.password);
  });

  it("a support agent is refused (FAIL forbidden)", async (t) => {
    if (!inst) return t.skip();
    const exp = runExport([]);
    const key = new RegExp(`PASS exported ${seed.B.org} -> (\\S+)`).exec(
      exp.output,
    )![1]!;
    const { status, output } = await runRestore(staff.agent!, [
      "--org",
      seed.B.org,
      "--key",
      key,
    ]);
    expect(status).toBe(1);
    expect(output).toContain("FAIL forbidden");
    expect(output).not.toContain(staff.agent!.password);
  });

  it("refuses a key that is not this org's export", async (t) => {
    if (!inst) return t.skip();
    const { status, output } = await runRestore(staff.super!, [
      "--org",
      seed.A.org,
      "--key",
      tenantExportKey(seed.B.org, new Date()),
    ]);
    expect(status).toBe(1);
    expect(output).toContain(
      "FAIL --key must be an export of this organization",
    );
  });
});
