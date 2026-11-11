// Media staff tools (07-27; CONT-19, CONT-33, D249; T-07-27-05..07, T-07-27-09) against a
// throwaway PocketBase 0.39.11: listMediaUsage / describeTakedown / takedownMedia as functions,
// then the media:usage and media:takedown CLIs spawned with the same flags as the root npm
// scripts. Output must never carry the password, the code or a storage key.
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import type { PlatformContext } from "../src/context";
import type { MediaDelivery } from "../src/media/ports";
import { listMediaUsage } from "../src/media/ops/usage-report";
import { describeTakedown, takedownMedia } from "../src/media/ops/takedown";
import type { ObjectStore } from "../src/storage/object-store";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedMediaRow } from "./media-seed";
import { staffContext } from "./seeded";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const REGISTER = pathToFileURL(
  join(PKG_DIR, "scripts", "register-ts.mjs"),
).href;
const SCRIPTS = {
  usage: join(PKG_DIR, "scripts", "media-usage.ts"),
  takedown: join(PKG_DIR, "scripts", "media-takedown.ts"),
} as const;
type Cli = keyof typeof SCRIPTS;
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  REGISTER,
];
const TAKEN_DOWN =
  "Taken down. The file is gone from the site and the CDN; pages refresh within 5 minutes.";
const GB = 1024 ** 3;

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let superCtx: PlatformContext;
let agentCtx: PlatformContext;
const staff: Record<string, { id: string; email: string; password: string }> =
  {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sections = () => composeSectionRegistry(CORE_SECTIONS, []);

function childEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CDS_ENV;
  for (const k of Object.keys(env)) if (k.startsWith("WASABI_")) delete env[k];
  return env as NodeJS.ProcessEnv;
}

function runQuick(cli: Cli, args: string[]) {
  const r = spawnSync(
    process.execPath,
    [...NODE_FLAGS, SCRIPTS[cli], ...args],
    { cwd: REPO_ROOT, encoding: "utf8", env: childEnv(), timeout: 60_000 },
  );
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

async function runCli(
  cli: Cli,
  who: { id: string; email: string; password: string },
  args: string[],
): Promise<{ status: number | null; output: string; code: string }> {
  const mark = inst!.stdout().length;
  const child = spawn(
    process.execPath,
    [...NODE_FLAGS, SCRIPTS[cli], ...args],
    {
      cwd: REPO_ROOT,
      env: childEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
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
  const email = `media-cli-${key}@cds.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: role,
  });
  staff[key] = { id: rec.id, email, password };
}

async function rowExists(id: string): Promise<boolean> {
  try {
    await pb.collection("media_assets").getOne(id);
    return true;
  } catch {
    return false;
  }
}

async function takedownAudits(id: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("action = 'media_assets.takedown' && target_id = {:id}", {
      id,
    }),
  });
}

function noSecrets(out: string, who: { password: string }, code = ""): void {
  expect(out).not.toContain(who.password);
  if (code) expect(out).not.toContain(code);
  expect(out).not.toContain("tenants/");
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  await seedStaff("super", "super_admin");
  await seedStaff("agent", "support_agent");
  superCtx = await staffContext(inst, "media-fn-super@cds.test", "super_admin");
  agentCtx = await staffContext(
    inst,
    "media-fn-agent@cds.test",
    "support_agent",
  );
  // Org A: 1.7 GB (warn); org B: 0.5 GB.
  await seedMediaRow(seed.A.org, { bytes: Math.round(1.7 * GB), name: "big" });
  await seedMediaRow(seed.B.org, { bytes: Math.round(0.5 * GB) });
});

afterAll(async () => {
  await inst?.stop();
});

const ORG = "abcdefghijklmno";

describe("listMediaUsage (CONT-19)", () => {
  it("one row per org, sorted by used bytes; --over and --org filter", async (ctx) => {
    if (!inst) return ctx.skip();
    const rows = await listMediaUsage(agentCtx);
    expect(rows.map((r) => r.orgId)).toEqual([seed.A.org, seed.B.org]);
    expect(rows[0]).toMatchObject({
      name: "Org A",
      level: "warn",
      deliveryBytes: null,
    });
    expect((await listMediaUsage(agentCtx, { over: true })).length).toBe(1);
    const one = await listMediaUsage(agentCtx, { orgId: seed.B.org });
    expect(one.map((r) => r.orgId)).toEqual([seed.B.org]);
  });

  it("an OrgContext is refused", async (ctx) => {
    if (!inst) return ctx.skip();
    await expect(
      listMediaUsage(seed.ctxA as unknown as PlatformContext),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("describeTakedown / takedownMedia (D249, CONT-33)", () => {
  it("describes the case; another org's asset is NotFound; support agent Forbidden", async (ctx) => {
    if (!inst) return ctx.skip();
    const id = await seedMediaRow(seed.A.org, {
      name: "case.webp",
      bytes: 2048,
      public_at: new Date().toISOString(),
    });
    const c = await describeTakedown(superCtx, seed.A.org, id, {
      sections: sections(),
    });
    expect(c).toMatchObject({
      orgName: "Org A",
      asset: {
        id,
        kind: "library",
        name: "case.webp",
        bytes: 2048,
        public: true,
      },
      usedOn: [],
    });
    await expect(
      describeTakedown(superCtx, seed.B.org, id, { sections: sections() }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      describeTakedown(agentCtx, seed.A.org, id, { sections: sections() }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("hard-deletes, audits with the reason, removes objects and purges; then NotFound", async (ctx) => {
    if (!inst) return ctx.skip();
    const id = await seedMediaRow(seed.A.org, {
      public_at: new Date().toISOString(),
    });
    const purge = vi.fn(async () => undefined);
    const delivery: MediaDelivery = {
      name: "bunny",
      urlFor: () => "https://cdn.example.test/x",
      purge,
      deliveryBytes: async () => null,
    };
    const deleted: string[] = [];
    const publicStore = {
      delete: async (k: string) => {
        deleted.push(k);
      },
    } as unknown as ObjectStore;
    const deps = {
      sections: sections(),
      invalidator: recordingInvalidator(),
      delivery,
      publicStore,
    };
    // Support agents are refused and nothing is deleted.
    await expect(
      takedownMedia(
        agentCtx,
        { orgId: seed.A.org, assetId: id, reason: "x" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await rowExists(id)).toBe(true);

    const r = await takedownMedia(
      superCtx,
      { orgId: seed.A.org, assetId: id, reason: "DMCA notice 42" },
      deps,
    );
    expect(r.publicKeys).toBeGreaterThan(0);
    expect(await rowExists(id)).toBe(false);
    const rows = await takedownAudits(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization).toBe(seed.A.org);
    expect((rows[0]!.meta as { reason: string }).reason).toBe("DMCA notice 42");
    expect(purge).toHaveBeenCalledTimes(1);
    expect((purge.mock.calls[0] as unknown as [string[]])[0]).toEqual(deleted);
    expect(deleted.every((k) => k.includes(id))).toBe(true);

    await expect(
      takedownMedia(
        superCtx,
        { orgId: seed.A.org, assetId: id, reason: "again" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("media CLIs: arguments, help and dry runs", () => {
  it.each(["usage", "takedown"] as const)(
    "%s --help exits 0 and prints usage",
    (cli) => {
      const { status, output } = runQuick(cli, ["--help"]);
      expect(status).toBe(0);
      expect(output).toContain("--dry-run");
      expect(output).toContain("emailed sign-in code");
    },
  );

  it("unknown arguments are refused", () => {
    for (const cli of ["usage", "takedown"] as const) {
      const { status, output } = runQuick(cli, ["--nope"]);
      expect(status).toBe(1);
      expect(output).toContain("FAIL unknown argument --nope");
    }
  });

  it("media:usage --dry-run reads nothing", () => {
    const { status, output } = runQuick("usage", ["--dry-run"]);
    expect(status).toBe(0);
    expect(output).toContain(
      "DRY RUN would list media storage per site; nothing read",
    );
    expect(output).not.toContain("Staff email");
  });

  it("media:takedown refuses missing or bad arguments before any prompt", () => {
    const cases: [string[], string][] = [
      [["--org", ORG, "--asset", ORG], '--reason "<text>" is required'],
      [["--org", "bad", "--asset", ORG, "--reason", "x"], "--org is not"],
      [["--org", ORG, "--asset", "../x", "--reason", "x"], "--asset is not"],
      [["--asset", ORG, "--reason", "x"], "--org <org-id> is required"],
    ];
    for (const [args, msg] of cases) {
      const { status, output } = runQuick("takedown", args);
      expect(status, args.join(" ")).toBe(1);
      expect(output).toContain(`FAIL ${msg}`);
      expect(output).not.toContain("Staff email");
    }
  });
});

describe("media CLIs signed in", () => {
  it("media:usage as a support agent prints the table and summary", async (ctx) => {
    if (!inst) return ctx.skip();
    const who = staff.agent!;
    const r = await runCli("usage", who, []);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toMatch(
      /ORG\s+NAME\s+STORAGE\s+USED\s+FILES\s+DELIVERY \(MONTH\)/,
    );
    expect(r.output).toContain("Org A");
    expect(r.output).toContain("not tracked yet");
    expect(r.output).toMatch(
      /\d+ sites · [\d.]+ GB stored · \d+ at 80 % or more · \d+ full/,
    );
    noSecrets(r.output, who, r.code);
  });

  it("media:takedown --dry-run prints the case and deletes nothing", async (ctx) => {
    if (!inst) return ctx.skip();
    const id = await seedMediaRow(seed.A.org, {
      name: "dry.webp",
      bytes: 4096,
    });
    const who = staff.super!;
    const r = await runCli("takedown", who, [
      "--org",
      seed.A.org,
      "--asset",
      id,
      "--reason",
      "check",
      "--dry-run",
    ]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("dry.webp");
    expect(r.output).toContain("Not used on any page");
    expect(r.output).toContain("DRY RUN nothing deleted");
    expect(await rowExists(id)).toBe(true);
    noSecrets(r.output, who, r.code);
  });

  it("media:takedown --yes as super admin takes it down with an audit row", async (ctx) => {
    if (!inst) return ctx.skip();
    const id = await seedMediaRow(seed.A.org, { name: "gone.webp" });
    const who = staff.super!;
    const r = await runCli("takedown", who, [
      "--org",
      seed.A.org,
      "--asset",
      id,
      "--reason",
      "Copyright complaint",
      "--yes",
    ]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain(TAKEN_DOWN);
    expect(await rowExists(id)).toBe(false);
    expect(await takedownAudits(id)).toHaveLength(1);
    noSecrets(r.output, who, r.code);
  });

  it("media:takedown as a support agent is refused", async (ctx) => {
    if (!inst) return ctx.skip();
    const id = await seedMediaRow(seed.A.org, { name: "kept.webp" });
    const who = staff.agent!;
    const r = await runCli("takedown", who, [
      "--org",
      seed.A.org,
      "--asset",
      id,
      "--reason",
      "x",
      "--yes",
    ]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("Only a super admin can take media down.");
    expect(await rowExists(id)).toBe(true);
    noSecrets(r.output, who, r.code);
  });
});
