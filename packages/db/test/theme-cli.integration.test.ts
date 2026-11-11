// THEME-03 theme:import CLI (plan 04-10). Spawned with the same flags as the root npm
// script (Node type stripping + register-ts.mjs), not via npm. The dry-run and argument
// cases need no database; the real-import cases run against a throwaway PocketBase 0.39.11
// and answer the staff MFA prompts like an operator would. Output never carries secrets.
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ORG_NOT_FOUND_COPY,
  RESULT_DRY_RUN,
  RESULT_SUCCESS,
} from "@cds/core/theme/import";
import { resetClientForTests, superuser } from "../src/client";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const REGISTER = pathToFileURL(
  join(PKG_DIR, "scripts", "register-ts.mjs"),
).href;
const SCRIPT = join(PKG_DIR, "scripts", "theme-import.ts");
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  REGISTER,
];

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let who: { id: string; email: string; password: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run the CLI with no stdin: every case that must never reach a prompt. */
function run(args: string[]) {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    input: "",
    timeout: 60_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    output: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  };
}

function lastLine(text: string): string {
  const all = text.trimEnd().split(/\r?\n/);
  return all[all.length - 1] ?? "";
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

/** A real import: email, password, then the emailed code once the CLI asks for it. */
async function runImport(
  args: string[],
): Promise<{ status: number | null; output: string }> {
  const mark = inst!.stdout().length;
  const child = spawn(process.execPath, [...NODE_FLAGS, SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (c: Buffer) => (output += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (output += c.toString("utf8")));
  // "close", not "exit": stdout can still be flushing after exit (tenants-cli flake).
  const exited = new Promise<number | null>((resolve) =>
    child.once("close", (code) => resolve(code)),
  );
  child.stdin.write(`${who.email}\n${who.password}\n`);
  for (let i = 0; i < 1200; i++) {
    if (output.includes("Enter it below") || child.exitCode !== null) break;
    await sleep(50);
  }
  if (output.includes("Enter it below")) {
    child.stdin.write(`${await latestOtp(who.id, mark)}\n`);
  }
  child.stdin.end();
  return { status: await exited, output };
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  const email = "theme-staff@cds.test";
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: "support_agent",
  });
  who = { id: rec.id, email, password };
});

afterAll(async () => {
  await inst?.stop();
});

describe("theme:import CLI (no database)", () => {
  it("--help exits 0 and prints usage", () => {
    const { status, stdout } = run(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("theme:import");
    expect(stdout).toContain("--dry-run");
  });

  it("--dry-run prints the full Tidewater report and never prompts", () => {
    const { status, stdout, output } = run([
      "--dry-run",
      "--org",
      "x",
      "--dir",
      "design/tenants/demo-b",
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain('Theme "Tidewater"');
    expect(stdout).toContain("[DRY RUN, nothing written]");
    expect(stdout).toContain("Adjustments (1)");
    expect(stdout).toContain("accent on surface-raised");
    expect(lastLine(stdout)).toContain(RESULT_DRY_RUN);
    expect(output).not.toContain("Staff email");
  });

  it("--dry-run on the demo theme reports no adjustments", () => {
    const { status, stdout } = run([
      "--org",
      "x",
      "--dir",
      "design/tenants/demo",
      "--dry-run",
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("Adjustments (0)");
  });

  it("a directory outside design/ exits 1 with the containment copy", () => {
    const { status, output } = run([
      "--org",
      "x",
      "--dir",
      "../outside",
      "--dry-run",
    ]);
    expect(status).toBe(1);
    expect(lastLine(output)).toContain(
      "The theme directory must be inside design/",
    );
  });

  it("missing --dir exits 1 with usage", () => {
    const { status, output } = run(["--org", "x"]);
    expect(status).toBe(1);
    expect(output).toContain("--dir <theme-dir> is required");
    expect(output).toContain("npm run theme:import");
  });

  it("missing --org exits 1", () => {
    const { status, output } = run(["--dir", "design/tenants/demo"]);
    expect(status).toBe(1);
    expect(output).toContain("--org <org-id> is required");
  });
});

describe("theme:import CLI (real import)", () => {
  it("imports after a staff MFA sign-in, audited, secrets never printed", async (t) => {
    if (!inst) return t.skip();
    const { status, output } = await runImport([
      "--org",
      seed.A.org,
      "--dir",
      "design/tenants/demo-b",
    ]);
    expect(lastLine(output)).toContain(RESULT_SUCCESS);
    expect(status).toBe(0);
    expect(output).not.toContain(who.password);
    expect(output).not.toContain(inst.password);

    const org = await pb.collection("organizations").getOne(seed.A.org);
    expect((org.design as { name?: string }).name).toBe("Tidewater");
    const other = await pb.collection("organizations").getOne(seed.B.org);
    expect((other.design as { name?: string } | null)?.name).not.toBe(
      "Tidewater",
    );
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'theme.import' && actor = {:a}",
        { o: seed.A.org, a: who.id },
      ),
    });
    expect(rows.length).toBe(1);
  });

  it("an unknown org prints the shared not-found copy and exits 1", async (t) => {
    if (!inst) return t.skip();
    const { status, output } = await runImport([
      "--org",
      "nosuchorg000000",
      "--dir",
      "design/tenants/demo",
    ]);
    expect(lastLine(output)).toBe(ORG_NOT_FOUND_COPY("nosuchorg000000"));
    expect(status).toBe(1);
  });
});
