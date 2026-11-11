// P8 (08-18): the staff `site:assemble` CLI against a throwaway PocketBase 0.39.11 (TMPL-04;
// CONTEXT A2-Q1, A4-Q1; UI-SPEC "Staff CLI output"; invariant 10; T-08-18-01..05). Spawned
// with the same flags as the root npm script (Node type stripping + register-ts.mjs), answering
// the staff email, password and emailed-code prompts like an operator. A fresh org per case.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { listPages } from "../src/content/pages";
import { saveSection } from "../src/content/sections";
import { mintOrgContext, type OrgContext } from "../src/context";
import { seedCompleteIntake, seedMinimalIntake } from "../src/dev-seed-intake";
import { resetConfirmSendLimitsForTests } from "../src/rate-limit";
import { bootPb, type PbInstance } from "./pb-harness";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const REGISTER = pathToFileURL(
  join(PKG_DIR, "scripts", "register-ts.mjs"),
).href;
const SCRIPT = join(PKG_DIR, "scripts", "site-assemble.ts");
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  REGISTER,
];
const ORG = "zzzzzzzzzzzzzzz";
const NOT_SENT =
  "This site hasn't been sent to CDS yet, so there's nothing to assemble.";

const sections = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_REGISTRY.sections(),
);

type Who = { id: string; email: string; password: string };

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir: string;
let n = 0;
const staff: Record<string, Who> = {};
const saved: Record<string, string | undefined> = {};
const ENV = {
  CDS_ENV: "dev",
  CDS_PREVIEW_HOST_SUFFIX: "sites.localhost",
  CDS_STAFF_ALERT_EMAIL: "staff@cds.test",
  CDS_PREVIEW_PORT: "3000",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function childEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("WASABI_")) delete env[k];
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
    const out = inst!.stdout().slice(after);
    const all = [...out.matchAll(re)];
    if (all.length > 0) return all[all.length - 1]![1]!;
    await sleep(50);
  }
  throw new Error("no OTP_STANDIN line");
}

async function runCli(
  who: Who,
  args: string[],
): Promise<{ status: number | null; output: string }> {
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
  for (let i = 0; i < 1200; i++) {
    if (output.includes("Enter it below") || child.exitCode !== null) break;
    await sleep(50);
  }
  if (output.includes("Enter it below")) {
    const code = await latestOtp(who.id, mark);
    child.stdin.write(`${code}\n`);
  }
  child.stdin.end();
  const status = await exited;
  return { status, output };
}

async function seedUser(
  key: string,
  role: "super_admin" | "support_agent" | "",
): Promise<void> {
  const email = `asm-cli-${key}@cds.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    ...(role ? { staff_role: role } : {}),
    verified: true,
  });
  staff[key] = { id: rec.id, email, password };
}

async function readyOrg(): Promise<string> {
  n += 1;
  resetConfirmSendLimitsForTests();
  const slug = `asm-cli-${n}`;
  const { orgId } = await seedCompleteIntake(
    { slug, ownerEmail: `${slug}@cds.test` },
    { registry: ADDON_REGISTRY },
  );
  return orgId;
}

async function ownerCtx(orgId: string): Promise<OrgContext> {
  const m = await pb
    .collection("memberships")
    .getFirstListItem(
      pb.filter("organization = {:o} && role = 'owner'", { o: orgId }),
    );
  return mintOrgContext({
    orgId,
    actor: String(m.user),
    role: "owner",
    grants: [],
    ip: "127.0.0.1",
  });
}

const stageOf = async (orgId: string) =>
  String((await pb.collection("organizations").getOne(orgId)).stage);

const pageCount = async (orgId: string) =>
  (
    await pb.collection("pages").getList(1, 1, {
      filter: pb.filter("organization = {:o}", { o: orgId }),
    })
  ).totalItems;

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-asm-cli-"));
  for (const [k, v] of Object.entries({
    ...ENV,
    CDS_STORAGE_DIR: storageDir,
  })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  await seedUser("super", "super_admin");
  await seedUser("agent", "support_agent");
  await seedUser("plain", "");
}, 120_000);

afterAll(async () => {
  await inst?.stop();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(storageDir, { recursive: true, force: true });
});

describe("site:assemble arguments (no sign-in)", () => {
  it("--help prints the usage", () => {
    const r = runQuick(["--help"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("--org");
    expect(r.output).toContain("--rerun");
    expect(r.output).toContain("--dry-run");
    expect(r.output).toContain("super_admin or support_agent");
    expect(r.output).toContain(
      "Prompts for staff email, password and the emailed sign-in code",
    );
  });

  it("refuses a missing, malformed or unknown argument", () => {
    const missing = runQuick([]);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain("--org <org-id> is required");
    const bad = runQuick(["--org", "NOT-AN-ID"]);
    expect(bad.status).toBe(1);
    expect(bad.output).toContain("--org is not a valid organization id");
    const unknown = runQuick(["--org", ORG, "--force"]);
    expect(unknown.status).toBe(1);
    expect(unknown.output).toContain("unknown argument --force");
  });
});

describe("site:assemble (throwaway PocketBase)", () => {
  it("assembles a sent site and prints the slot report, then refuses a second run", async (t) => {
    if (!inst) return t.skip();
    const orgId = await readyOrg();
    const r = await runCli(staff.agent!, ["--org", orgId]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("Assembling…");
    expect(r.output).toMatch(
      /^Rivera Bakery · standard · standard-v1 \(v1\)$/m,
    );
    expect(r.output).toMatch(/^PAGE\s+SLOT\s+RESULT\s+NOTE$/m);
    expect(r.output).toMatch(/^Home\s+Hero\s+/m);
    expect(r.output).toMatch(/^About\s+/m);
    expect(r.output).toMatch(/^To polish: \d+/m);
    expect(r.output).toMatch(
      /^Assembled Rivera Bakery: 2 pages, \d+ slots \(\d+ filled, \d+ default used, \d+ left out\)\.$/m,
    );
    expect(r.output).toMatch(/^Preview: http:\/\/[a-z0-9.-]+:3000\/$/m);
    expect(r.output).not.toContain("Dry run");
    expect(await stageOf(orgId)).toBe("being_built");
    expect(await pageCount(orgId)).toBe(2);
    // Audited as the staff member impersonating the owner (invariant 10).
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'site.assembled'", {
        o: orgId,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.impersonator).toBe(staff.agent!.id);

    const again = await runCli(staff.agent!, ["--org", orgId]);
    expect(again.status, again.output).toBe(0);
    expect(again.output).toMatch(
      /Already assembled on \d{1,2} [A-Z][a-z]{2}\. Use --rerun to rebuild untouched pages\./,
    );
    expect(await pageCount(orgId)).toBe(2);
  }, 120_000);

  it("--rerun leaves an edited About alone and rebuilds Home", async (t) => {
    if (!inst) return t.skip();
    const orgId = await readyOrg();
    const first = await runCli(staff.super!, ["--org", orgId]);
    expect(first.status, first.output).toBe(0);
    const ctx = await ownerCtx(orgId);
    const about = (await listPages(ctx)).find((p) => p.slug === "about")!;
    await saveSection(ctx, sections, {
      pageId: about.id,
      section_type: "text-only",
      row_layout: "full",
      content: { heading: "Owner note", text: "<p>Mine</p>" },
    });
    const r = await runCli(staff.super!, ["--org", orgId, "--rerun"]);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain(
      "About  edited since it was assembled, left alone.",
    );
    expect(r.output).toMatch(/^Home\s+unchanged, rebuilt\.$/m);
    expect(r.output).toContain("Re-run done: 1 page rebuilt, 1 left alone.");
    expect(await pageCount(orgId)).toBe(2);
  }, 120_000);

  it("--dry-run prints the report and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const orgId = await readyOrg();
    const before = JSON.stringify(
      (
        await pb
          .collection("org_intake")
          .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }))
      ).assembly ?? null,
    );
    const r = await runCli(staff.agent!, ["--org", orgId, "--dry-run"]);
    expect(r.status, r.output).toBe(0);
    const lines = r.output
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .filter((l) => !/^(Staff email|Password|Code|Sign-in OTP|PASS)/.test(l))
      // A host CLI (e.g. Claude Code plugins) can inject hint lines into stdout.
      .filter((l) => !l.startsWith("<claude-code-hint"));
    expect(lines[0]).toBe("Dry run: nothing was written.");
    expect(lines[lines.length - 1]).toBe("Would assemble 2 pages.");
    expect(r.output).toMatch(/^PAGE\s+SLOT\s+RESULT\s+NOTE$/m);
    expect(r.output).not.toContain("Assembling…");
    expect(r.output).not.toContain("Preview:");
    expect(await pageCount(orgId)).toBe(0);
    expect(await stageOf(orgId)).toBe("ready_for_build");
    const after = JSON.stringify(
      (
        await pb
          .collection("org_intake")
          .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }))
      ).assembly ?? null,
    );
    expect(after).toBe(before);
  }, 120_000);

  it("an unsent site, an unknown org and a non-staff account are refused", async (t) => {
    if (!inst) return t.skip();
    n += 1;
    const { orgId } = await seedMinimalIntake({
      slug: `asm-cli-min-${n}`,
      ownerEmail: `asm-cli-min-${n}@cds.test`,
    });
    const unsent = await runCli(staff.agent!, ["--org", orgId]);
    expect(unsent.status).toBe(1);
    expect(unsent.output).toContain(NOT_SENT);
    expect(await pageCount(orgId)).toBe(0);

    const missing = await runCli(staff.agent!, ["--org", ORG]);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain(
      `Org ${ORG} not found, or this account isn't CDS staff.`,
    );

    const ready = await readyOrg();
    const plain = await runCli(staff.plain!, ["--org", ready]);
    expect(plain.status).toBe(1);
    expect(plain.output).toContain(
      `Org ${ready} not found, or this account isn't CDS staff.`,
    );
    expect(plain.output).not.toContain(staff.plain!.password);
    expect(await pageCount(ready)).toBe(0);
    expect(await stageOf(ready)).toBe("ready_for_build");
  }, 180_000);
});
