// Staff onboarding CLIs (06-10: leads:list, fit:review, prices:set) against a throwaway
// PocketBase 0.39.11 (ONB-07, ONB-12, ONB-06; T-06-47..T-06-51). Spawned with the same flags
// as the root npm scripts (Node type stripping + register-ts.mjs), not via npm. Output must
// never carry secrets.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AUP_TEST_TERMS } from "@cds/core/onboarding";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { seedTwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const REGISTER = pathToFileURL(
  join(PKG_DIR, "scripts", "register-ts.mjs"),
).href;
const SCRIPTS = {
  leads: join(PKG_DIR, "scripts", "leads-list.ts"),
  fit: join(PKG_DIR, "scripts", "fit-review.ts"),
  prices: join(PKG_DIR, "scripts", "prices-set.ts"),
} as const;
type Cli = keyof typeof SCRIPTS;
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  REGISTER,
];
const DECLINED = "Declined. The owner was emailed and the site is held.";
const APPROVED = "Approved. The owner can go to checkout when it opens.";
const SAVED = "Saved. The configurator shows the new price on its next load.";

let inst: PbInstance | null = null;
let pb: PocketBase;
const staff: Record<string, { id: string; email: string; password: string }> =
  {};
let n = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function childEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CDS_ENV;
  for (const k of Object.keys(env)) if (k.startsWith("WASABI_")) delete env[k];
  return env as NodeJS.ProcessEnv;
}

/** Runs without prompts (help, argument errors, offline dry runs). */
function runQuick(cli: Cli, args: string[]) {
  const r = spawnSync(
    process.execPath,
    [...NODE_FLAGS, SCRIPTS[cli], ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: childEnv(),
      timeout: 60_000,
    },
  );
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

/** Run a CLI, answering the prompts like an operator would. */
async function runCli(
  cli: Cli,
  who: { id: string; email: string; password: string },
  args: string[],
  answers: string[] = [],
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
    for (const a of answers) child.stdin.write(`${a}\n`);
  }
  child.stdin.end();
  const status = await exited;
  return { status, output, code };
}

async function seedStaff(
  key: string,
  role: "super_admin" | "support_agent",
): Promise<void> {
  const email = `onb-cli-${key}@cds.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const rec = await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    staff_role: role,
  });
  staff[key] = { id: rec.id, email, password };
}

/** An org held for review, as Submit leaves it (06-08). */
async function heldOrg(submitted = false): Promise<string> {
  n += 1;
  const ownerEmail = `onb-cli-owner-${n}@cds.test`;
  const pw = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const user = await pb.collection("users").create({
    email: ownerEmail,
    password: pw,
    passwordConfirm: pw,
  });
  const org = await pb.collection("organizations").create({
    name: `Held Org ${n}`,
    slug: `onb-cli-held-${n}`,
    status: "active",
    path: "standard",
    stage: "fit_review",
  });
  await pb
    .collection("memberships")
    .create({ user: user.id, organization: org.id, role: "owner" });
  await pb.collection("business_profile").create({
    organization: org.id,
    business_type: "cbd-shop",
    description: `Organic ${AUP_TEST_TERMS.review} tea`,
    public_email: ownerEmail,
  });
  await pb.collection("org_intake").create({
    organization: org.id,
    selections: {},
    submitted_at: submitted ? new Date().toISOString() : "",
  });
  await pb.collection("org_email_routes").create({
    organization: org.id,
    purpose: "default",
    address: ownerEmail,
    confirmed_at: new Date().toISOString(),
  });
  return org.id;
}

async function audits(filter: string, params: Record<string, string>) {
  return pb
    .collection("audit_log")
    .getFullList({ filter: pb.filter(filter, params) });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  await seedTwoOrgs(pb);
  await seedStaff("super", "super_admin");
  await seedStaff("super2", "super_admin");
  await seedStaff("super3", "super_admin");
  await seedStaff("agent", "support_agent");
  await pb.collection("quotes").create({
    token_hash: createHash("sha256")
      .update(randomBytes(32).toString("base64url"))
      .digest("hex"),
    status: "saved",
    path: "studio",
    email: "lead-quote@cds.test",
    business_type: "coach",
    selections: {
      addons: ["testimonials"],
      extras: [],
      carePlan: false,
      cadence: "monthly",
    },
    saved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
});

afterAll(async () => {
  await inst?.stop();
});

const ORG = "abcdefghijklmno";

describe("staff onboarding CLIs: arguments, help and dry runs", () => {
  it.each(["leads", "fit", "prices"] as const)(
    "%s --help exits 0 and prints usage",
    (cli) => {
      const { status, output } = runQuick(cli, ["--help"]);
      expect(status).toBe(0);
      expect(output).toContain("--dry-run");
      expect(output).toContain("emailed sign-in code");
    },
  );

  it("unknown arguments are refused", () => {
    expect(runQuick("leads", ["--all"]).output).toContain(
      "FAIL unknown argument --all",
    );
    const r = runQuick("prices", ["--kind", "plan", "--force"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("FAIL unknown argument --force");
  });

  it("leads:list --dry-run and a bad --since", () => {
    const ok = runQuick("leads", ["--since", "7d", "--dry-run"]);
    expect(ok.status).toBe(0);
    expect(ok.output).toContain(
      "DRY RUN would list leads changed in the last 7 day(s)",
    );
    expect(ok.output).not.toContain("Staff email");
    const bad = runQuick("leads", ["--since", "7w", "--dry-run"]);
    expect(bad.status).toBe(1);
    expect(bad.output).toContain("FAIL --since must look like 7d");
  });

  it("prices:set --dry-run prints the new price in dollars; bad input is refused", () => {
    const ok = runQuick("prices", [
      "--kind",
      "addon",
      "--key",
      "testimonials",
      "--path",
      "standard",
      "--monthly",
      "900",
      "--dry-run",
    ]);
    expect(ok.status).toBe(0);
    expect(ok.output).toContain(
      "DRY RUN would set Testimonials, Standard to $9.00/mo",
    );
    const unset = runQuick("prices", [
      "--kind=extra",
      "--key=copywriting",
      "--path=studio",
      "--unset",
      "--dry-run",
    ]);
    expect(unset.output).toContain(
      "DRY RUN would set Copywriting, Studio to Price coming soon",
    );
    const wrongDim = runQuick("prices", [
      "--kind",
      "extra",
      "--key",
      "copywriting",
      "--path",
      "standard",
      "--monthly",
      "900",
      "--dry-run",
    ]);
    expect(wrongDim.status).toBe(1);
    expect(wrongDim.output).toContain("extra is priced one-time; use --once");
    const unknown = runQuick("prices", [
      "--kind",
      "addon",
      "--key",
      "nope",
      "--path",
      "standard",
      "--monthly",
      "1",
      "--dry-run",
    ]);
    expect(unknown.output).toContain("FAIL unknown add-on nope");
    const dollars = runQuick("prices", [
      "--kind",
      "plan",
      "--key",
      "base",
      "--path",
      "standard",
      "--monthly",
      "9.00",
      "--dry-run",
    ]);
    expect(dollars.output).toContain("FAIL --monthly must be whole cents");
  });

  it("prices:set refuses Studio Booking on Standard; a $0 add-on dry run warns (review WR-A03)", () => {
    const studio = runQuick("prices", [
      "--kind",
      "addon",
      "--key",
      "studio-booking-solo",
      "--path",
      "standard",
      "--monthly",
      "4900",
      "--dry-run",
    ]);
    expect(studio.status).toBe(1);
    expect(studio.output).toContain(
      "FAIL Studio Booking is offered on the Studio path only",
    );
    const free = runQuick("prices", [
      "--kind",
      "addon",
      "--key",
      "testimonials",
      "--path",
      "standard",
      "--monthly",
      "0",
      "--dry-run",
    ]);
    expect(free.status).toBe(0);
    expect(free.output).toContain(
      "This makes Testimonials included free for every Standard site.",
    );
  });

  it("fit:review needs exactly one of --approve/--decline and a 1-500 character reason", () => {
    const both = runQuick("fit", [
      "--org",
      ORG,
      "--approve",
      "--decline",
      "--reason",
      "x",
    ]);
    expect(both.status).toBe(1);
    expect(both.output).toContain("FAIL give exactly one of");
    const empty = runQuick("fit", ["--org", ORG, "--approve", "--reason", " "]);
    expect(empty.output).toContain("FAIL --reason must be 1-500 characters");
    const badOrg = runQuick("fit", [
      "--org",
      "../x",
      "--decline",
      "--reason",
      "x",
    ]);
    expect(badOrg.output).toContain(
      "FAIL --org is not a valid organization id",
    );
  });
});

describe("staff onboarding CLIs: real runs (MFA sign-in)", () => {
  it("prices:set saves through setPrice and prints old -> new (audited)", async (t) => {
    if (!inst) return t.skip();
    const who = staff.super!;
    const r = await runCli("prices", who, [
      "--kind",
      "addon",
      "--key",
      "testimonials",
      "--path",
      "standard",
      "--monthly",
      "900",
    ]);
    expect(r.output).toContain(
      "Testimonials, Standard: Price coming soon -> $9.00/mo",
    );
    expect(r.output.trimEnd().endsWith(SAVED)).toBe(true);
    expect(r.status).toBe(0);
    expect(r.output).not.toContain(who.password);
    expect(r.output).not.toContain(r.code);
    const row = await pb
      .collection("price_catalog")
      .getFirstListItem(
        "item_kind = 'addon' && item_key = 'testimonials' && path = 'standard'",
      );
    expect(row.monthly_cents).toBe(900);
    expect(row.priced).toBe(true);
    const rows = await audits("action = 'price_catalog.set' && actor = {:a}", {
      a: who.id,
    });
    expect(rows.length).toBe(1);
  });

  it("prices:set to $0 on an add-on prints the sites affected and asks first (review WR-A03)", async (t) => {
    if (!inst) return t.skip();
    // Its own super_admin: more sign-ins on staff.super make a later case's OTP fail.
    const who = staff.super3!;
    const args = [
      "--kind",
      "addon",
      "--key",
      "credentials",
      "--path",
      "standard",
      "--monthly",
      "0",
    ];
    const onStandard = (
      await pb.collection("organizations").getList(1, 1, {
        filter: "path = 'standard'",
      })
    ).totalItems;
    const priced = () =>
      pb.collection("price_catalog").getFullList({
        filter:
          "item_kind = 'addon' && item_key = 'credentials' && path = 'standard' && priced = true",
      });
    const before = await priced();
    const no = await runCli("prices", who, args, ["n"]);
    expect(no.output).toContain(
      `This makes Credentials included free for every Standard site (${onStandard} ${onStandard === 1 ? "site" : "sites"}).`,
    );
    expect(no.output).toContain("Cancelled. Nothing was saved.");
    expect(no.status).toBe(0);
    expect(await priced()).toEqual(before);

    const yes = await runCli("prices", who, [...args, "--yes"]);
    expect(yes.status).toBe(0);
    expect(yes.output).toContain("included free for every Standard site");
    expect(yes.output.trimEnd().endsWith(SAVED)).toBe(true);
    const [row] = await priced();
    expect(row?.monthly_cents).toBe(0);
    // Put it back so later tests see the seeded "Price coming soon".
    await pb.collection("price_catalog").update(row!.id, { priced: false });
  });

  it("prices:set by a support agent is refused", async (t) => {
    if (!inst) return t.skip();
    const r = await runCli("prices", staff.agent!, [
      "--kind",
      "addon",
      "--key",
      "credentials",
      "--path",
      "standard",
      "--monthly",
      "500",
    ]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("FAIL forbidden");
  });

  it("fit:review --dry-run prints the case and changes nothing", async (t) => {
    if (!inst) return t.skip();
    const orgId = await heldOrg();
    const r = await runCli("fit", staff.super!, [
      "--org",
      orgId,
      "--decline",
      "--reason",
      "Checking",
      "--dry-run",
    ]);
    expect(r.status).toBe(0);
    expect(r.output).toContain(`(${orgId})`);
    // Every screened field is printed (R2-CR-01), not only the description.
    expect(r.output).toMatch(/business_type:\s+cbd-shop/);
    expect(r.output).toMatch(
      new RegExp(`description:\\s+Organic ${AUP_TEST_TERMS.review} tea`),
    );
    expect(r.output).toMatch(/org_name:\s+Held Org/);
    expect(r.output).toContain(`keyword: ${AUP_TEST_TERMS.review}`);
    expect(r.output).toContain(`DRY RUN would decline org ${orgId}`);
    const org = await pb.collection("organizations").getOne(orgId);
    expect(org.status).toBe("active");
    expect(org.stage).toBe("fit_review");
  });

  it("fit:review --decline holds the site (audited with the reason)", async (t) => {
    if (!inst) return t.skip();
    const orgId = await heldOrg();
    const reason = "Outside the AUP after review";
    const r = await runCli("fit", staff.super!, [
      "--org",
      orgId,
      "--decline",
      "--reason",
      reason,
      "--yes",
    ]);
    expect(r.output.trimEnd().endsWith(DECLINED)).toBe(true);
    expect(r.status).toBe(0);
    expect((await pb.collection("organizations").getOne(orgId)).status).toBe(
      "held",
    );
    const rows = await audits("organization = {:o} && action = 'fit.decline'", {
      o: orgId,
    });
    expect(rows.length).toBe(1);
    expect(JSON.stringify(rows[0]!.meta)).toContain(reason);
  });

  it("fit:review --approve on a sent intake points at site:assemble (08-18)", async (t) => {
    if (!inst) return t.skip();
    const orgId = await heldOrg(true);
    // Its own super_admin: one more sign-in on staff.super makes a later case's OTP fail.
    const r = await runCli("fit", staff.super2!, [
      "--org",
      orgId,
      "--approve",
      "--reason",
      "Tea shop, fine",
      "--yes",
    ]);
    expect(r.status).toBe(0);
    expect(r.output).toContain(APPROVED);
    expect(
      r.output
        .trimEnd()
        .endsWith(
          `Assembly runs within the hour. To run it now: npm run site:assemble -- --org ${orgId}`,
        ),
    ).toBe(true);
    expect((await pb.collection("organizations").getOne(orgId)).stage).toBe(
      "ready_for_build",
    );
  });

  it("fit:review --approve clears the site back to intake", async (t) => {
    if (!inst) return t.skip();
    const orgId = await heldOrg();
    const r = await runCli("fit", staff.super!, [
      "--org",
      orgId,
      "--approve",
      "--reason",
      "Tea shop, fine",
      "--yes",
    ]);
    expect(r.output.trimEnd().endsWith(APPROVED)).toBe(true);
    expect(r.status).toBe(0);
    expect((await pb.collection("organizations").getOne(orgId)).stage).toBe(
      "intake",
    );
    const rows = await audits("organization = {:o} && action = 'fit.approve'", {
      o: orgId,
    });
    expect(rows.length).toBe(1);
  });

  it("fit:review by a support agent, or for a missing org, gives the not-found line", async (t) => {
    if (!inst) return t.skip();
    const orgId = await heldOrg();
    const agent = await runCli("fit", staff.agent!, [
      "--org",
      orgId,
      "--approve",
      "--reason",
      "x",
    ]);
    expect(agent.status).toBe(1);
    expect(agent.output).toContain(
      `Org ${orgId} not found, or this account isn't CDS staff.`,
    );
    const missing = await runCli("fit", staff.super!, [
      "--org",
      ORG,
      "--approve",
      "--reason",
      "x",
    ]);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain(
      `Org ${ORG} not found, or this account isn't CDS staff.`,
    );
    expect((await pb.collection("organizations").getOne(orgId)).stage).toBe(
      "fit_review",
    );
  });

  it("leads:list (support agent) prints the columns and the summary line", async (t) => {
    if (!inst) return t.skip();
    await heldOrg();
    const r = await runCli("leads", staff.agent!, ["--since", "1d"]);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(
      /KIND\s+EMAIL\s+PATH\s+TYPE\s+ITEMS\s+STATUS\s+ASSEMBLED\s+LAST CHANGE/,
    );
    expect(r.output).toMatch(
      /quote\s+lead-quote@cds\.test\s+studio\s+coach\s+1\s+saved/,
    );
    expect(r.output).toMatch(
      /org\s+onb-cli-owner-\d+@cds\.test\s+standard\s+cbd-shop/,
    );
    expect(r.output).toMatch(
      /\d+ leads: 1 saved quote, \d+ sites? in setup\.\s*$/,
    );
  });
});
