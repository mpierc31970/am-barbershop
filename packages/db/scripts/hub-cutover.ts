// hub:cutover (15-25; HUB-04, D62, A4-Q1..Q4, P15-P21). The guarded command that moves
// connectionsdesignstudios.com from the old marketing site to the platform hub. The planner
// (preflight, apply, rollback) is ../src/ops/hub-cutover.ts; this file wires the real ports:
// Coolify API (../src/ops/coolify.ts), public DNS (1.1.1.1 + 8.8.8.8), an HTTPS probe, the
// production PocketBase `_migrations` table read over ssh (read-only), a local state file and
// the runbook's Run log.
//
// Usage: see USAGE. Never prints the Coolify token or any env value (T-15-25-01).
// The build session runs only `check` (read-only) and `--dry-run` (P15-P21).
import { spawnSync } from "node:child_process";
import { Resolver } from "node:dns/promises";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS, PARITY, TESTIMONIALS, WORK_SITES } from "@cds/core/marketing";
import {
  COOLIFY_BASE_URL,
  COOLIFY_TUNNEL_COMMAND,
  coolifyApi,
  isSecureCoolifyUrl,
  readCoolifyToken,
} from "../src/ops/coolify";
import { fakeCoolify, type FakeCoolify } from "../src/ops/fake-coolify";
import {
  COOLIFY_WRITE_METHODS,
  CUTOVER_RESOLVERS,
  CutoverRefused,
  HUB_CUTOVER_DEFAULTS,
  applyCutover,
  cutoverPlan,
  preflight,
  rollbackCutover,
  type CheckRow,
  type CoolifyApi,
  type CoolifyApp,
  type CoolifyEnvVar,
  type CutoverConfig,
  type CutoverDeps,
  type CutoverReadiness,
  type HttpsProbe,
  type MigrationsReader,
  type Resolver as CutoverResolver,
  type SavedCutoverState,
  type StateStore,
} from "../src/ops/hub-cutover";
import { migrationFiles } from "./migrations-dir.mjs";
import {
  CliFail,
  ask,
  fail,
  parseArgs,
  runMain,
  table,
  wantsHelp,
  type ParsedArgs,
} from "./staff-cli";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const DEFAULT_STATE = join(REPO_ROOT, ".planning", "tmp", "cutover-state.json");
const DEFAULT_RUNBOOK = join(REPO_ROOT, "docs", "ops", "hub-cutover.md");

/** ssh alias of the data VPS (the host, not a container; CLAUDE.md). */
const SSH_HOST = "pocketbase-cds";
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
/** The only PocketBase file the migrations check reads: production's, opened read-only. */
const PROD_DB = "/root/pocketbase-cdsp-prod/pb_data/data.db";

const DRY = "Dry run: nothing was changed.";
const READ_ONLY = "Read-only: nothing was written.";

export const USAGE = `hub:cutover - move ${HUB_CUTOVER_DEFAULTS.apex} to the platform hub (HUB-04, D62)

  npm run hub:cutover -- plan                 the eight apply steps; touches nothing
  npm run hub:cutover -- check                read-only preflight: one PASS/FAIL/WARN row each
  npm run hub:cutover -- apply                check, show the plan, type the domain, cut over
  npm run hub:cutover -- rollback             put both apps back from the saved state

Flags:
  --dry-run              print the steps only (any subcommand); nothing is called
  --yes                  skip the typed domain; only in a non-interactive run (no terminal)
  --expect-sha <sha>     the commit prod must report (default: git origin/main, else HEAD)
  --mailboxes-ready      hello@ and abuse@ receive mail (otherwise that row WARNs)
  --state <path>         saved state file (default .planning/tmp/cutover-state.json)
  --log-file <path>      run log (default docs/ops/hub-cutover.md, "## Run log")
  --coolify-url <url>    Coolify API base (default ${COOLIFY_BASE_URL}, via the SSH tunnel)
  --insecure-http        allow a plain http:// --coolify-url to a non-loopback host (sends the
                         token in cleartext; avoid)
  --help                 this text

Coolify API: open the SSH tunnel first (${COOLIFY_TUNNEL_COMMAND}).
Coolify token: ~/.coolify_api_token, else .env.local COOLIFY_API_TOKEN. Never printed.
Runbook: docs/ops/hub-cutover.md. A failed deploy or verify rolls back on its own.`;

type Sub = "plan" | "check" | "apply" | "rollback";
const SUBS: readonly Sub[] = ["plan", "check", "apply", "rollback"];

// ---------------------------------------------------------------------------------------------
// Readiness (choice 3)
// ---------------------------------------------------------------------------------------------

export function readiness(mailboxes: boolean): CutoverReadiness {
  return {
    claimsVerified: CLAIMS.filter((c) => c.status === "verified").length,
    proofConfirmed:
      WORK_SITES.filter((w) => w.confirmed).length +
      TESTIMONIALS.filter((t) => t.confirmed).length,
    parityComplete: PARITY.length > 0 && PARITY.every((p) => Boolean(p.status)),
    mailboxes,
  };
}

// ---------------------------------------------------------------------------------------------
// Real ports
// ---------------------------------------------------------------------------------------------

class SshUnavailable extends Error {
  override name = "SshUnavailable";
}

/** Public DNS only: a fresh resolver bound to exactly the one server asked. */
function publicResolver(): CutoverResolver {
  return {
    async resolve4(host, server) {
      if (!CUTOVER_RESOLVERS.includes(server)) return [];
      const r = new Resolver({ timeout: 5000, tries: 2 });
      r.setServers([server]);
      try {
        return await r.resolve4(host);
      } catch {
        return [];
      }
    },
  };
}

const BODY_CAP = 1_000_000;

function httpsProbe(): HttpsProbe {
  return async (url) => {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "cds-hub-cutover/1" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.text()).slice(0, BODY_CAP);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { status: res.status, body, headers };
  };
}

function expectedMigrations(): string[] {
  return migrationFiles().map((f) => basename(f));
}

/** Production `_migrations`, opened `mode=ro` over ssh (migrate-dev.mjs pattern). */
function sshMigrations(cfg: CutoverConfig): MigrationsReader {
  if (cfg.prodPbDataPath !== PROD_DB) {
    fail(`refusing a PocketBase path other than ${PROD_DB}`);
  }
  const cmd = `python3 -c "import sqlite3; c = sqlite3.connect('file:${PROD_DB}?mode=ro', uri=True); print('\\n'.join(r[0] for r in c.execute('select file from _migrations')))"`;
  return {
    async expected() {
      return expectedMigrations();
    },
    async applied() {
      const r = spawnSync("ssh", [...SSH_OPTS, SSH_HOST, cmd], {
        encoding: "utf8",
        timeout: 60_000,
      });
      if (r.error || r.status !== 0)
        throw new SshUnavailable("ssh unavailable");
      return r.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    },
  };
}

function fileState(path: string): StateStore {
  return {
    async save(state) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    },
    async load() {
      if (!existsSync(path)) return null;
      const raw = JSON.parse(
        readFileSync(path, "utf8"),
      ) as Partial<SavedCutoverState>;
      if (
        typeof raw.oldFqdn !== "string" ||
        typeof raw.prodFqdn !== "string" ||
        typeof raw.at !== "string"
      ) {
        fail(`saved state at ${path} is not a cutover state`);
      }
      return { oldFqdn: raw.oldFqdn, prodFqdn: raw.prodFqdn, at: raw.at };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Run log (choice 4)
// ---------------------------------------------------------------------------------------------

/** `- YYYY-MM-DD HH:MM UTC · <command> · <step> · <ok|failed>` under `## Run log`. */
export function runLogLine(command: string, plannerLine: string): string {
  const stamp = plannerLine.slice(0, 20);
  const rest = plannerLine.slice(23);
  return `- ${stamp} · ${command} · ${rest}`;
}

function stampNow(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function appendRunLog(path: string, line: string): void {
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  let add = "";
  if (!/^## Run log\s*$/m.test(text)) {
    add += `${text === "" || text.endsWith("\n") ? "" : "\n"}\n## Run log\n\n`;
  } else {
    if (!text.endsWith("\n")) add += "\n";
    // Keep the list its own block: a blank line after a closing paragraph line.
    const last = text.trimEnd().split("\n").pop() ?? "";
    if (!text.endsWith("\n\n") && !last.startsWith("- ")) add += "\n";
  }
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${add}${line}\n`, "utf8");
}

// ---------------------------------------------------------------------------------------------
// Test mode (choice 5): CDS_CUTOVER_FAKE swaps every port for an in-memory one. VITEST only.
// ---------------------------------------------------------------------------------------------

/** Values the fake env carries so tests can prove they are never printed. */
export const FAKE_SECRET_MARK = "FAKE-SECRET-VALUE-7d1f";
export const FAKE_SHA = "fakesha0000000000000000000000000000000000";

type FakeMode = "ready" | "placeholder";

function fakeMode(): FakeMode | null {
  const v = process.env.CDS_CUTOVER_FAKE;
  if (!v) return null;
  if (!process.env.VITEST) {
    fail("CDS_CUTOVER_FAKE is a test hook and works only under vitest");
  }
  return v === "placeholder" ? "placeholder" : "ready";
}

function fakeWorld(mode: FakeMode, cfg: CutoverConfig) {
  const sslipHost = new URL(cfg.prodSslipUrl).hostname;
  const oldApp: CoolifyApp = {
    uuid: cfg.oldAppUuid,
    fqdn: `https://${cfg.apex},https://${cfg.www}`,
    status: "running:healthy",
    git_repository: cfg.expectedRepo,
    git_branch: "archive/marketing-site-v1",
    build_pack: "nixpacks",
    ports_exposes: "3000",
    dockerfile_location: null,
    health_check_path: null,
  };
  const prodApp: CoolifyApp =
    mode === "ready"
      ? {
          uuid: cfg.prodAppUuid,
          fqdn: cfg.prodSslipUrl,
          status: "running:healthy",
          git_repository: cfg.expectedRepo,
          git_branch: cfg.expectedBranch,
          build_pack: "dockerfile",
          ports_exposes: cfg.expectedPort,
          dockerfile_location: "/Dockerfile",
          health_check_path: cfg.healthPath,
        }
      : {
          uuid: cfg.prodAppUuid,
          fqdn: cfg.prodSslipUrl,
          status: "running:healthy",
          git_repository: "",
          git_branch: "",
          build_pack: "dockerfile",
          ports_exposes: "80",
          dockerfile_location: null,
          health_check_path: null,
        };
  const env = (
    key: string,
    value: string,
    buildtime = false,
  ): CoolifyEnvVar => ({
    key,
    value,
    is_preview: false,
    is_buildtime: buildtime,
  });
  const secret = (k: string) => `${FAKE_SECRET_MARK}-${k}`;
  const prodEnv: CoolifyEnvVar[] =
    mode === "ready"
      ? [
          env("PLATFORM_HOSTS", `${cfg.apex},${cfg.www},${sslipHost}`),
          env("CDS_PLATFORM_URL", `https://${cfg.apex}`),
          env("CDS_ENV", "production"),
          env("APP_VERSION", FAKE_SHA),
          env("PB_URL", "https://pb.example.invalid"),
          env("PB_APP_KEY", secret("PB_APP_KEY")),
          env("CDS_JOB_TOKEN", secret("CDS_JOB_TOKEN")),
          env("NEXT_PUBLIC_TURNSTILE_SITE_KEY", secret("SITE"), true),
          env("TURNSTILE_SECRET_KEY", secret("TURNSTILE")),
        ]
      : [
          env("CDS_ENV", "production"),
          env("PB_URL", "https://pb.example.invalid"),
          env("PB_APP_KEY", secret("PB_APP_KEY")),
          env("TRUSTED_PROXY_HOPS", "1"),
        ];
  const coolify = fakeCoolify({
    apps: [oldApp, prodApp],
    envs: { [cfg.prodAppUuid]: prodEnv },
  });
  const resolver: CutoverResolver = {
    async resolve4() {
      return mode === "ready" ? [cfg.edgeIpv4] : ["203.0.113.10"];
    },
  };
  // Route like the proxy: by each app's labels at its last deploy (fake-coolify `routes`).
  const probe: HttpsProbe = async (url) => {
    const holders = coolify.routes(new URL(url).hostname);
    if (holders.length === 0) {
      return { status: 404, body: "no available server", headers: {} };
    }
    if (!holders.includes(cfg.prodAppUuid)) {
      return { status: 200, body: "<html>archive site</html>", headers: {} };
    }
    const health = url.endsWith(cfg.healthPath);
    if (mode === "placeholder") {
      return health
        ? { status: 404, body: "not found", headers: {} }
        : { status: 200, body: "<html>placeholder</html>", headers: {} };
    }
    if (health) {
      return {
        status: 200,
        body: JSON.stringify({ status: "ok", version: FAKE_SHA }),
        headers: {},
      };
    }
    return {
      status: 200,
      body: `<html><head>${cfg.hubMarker} /></head></html>`,
      headers: {},
    };
  };
  const expected = expectedMigrations();
  const migrations: MigrationsReader = {
    async expected() {
      return expected;
    },
    async applied() {
      return mode === "ready" ? expected : expected.slice(0, 15);
    },
  };
  return { coolify, resolver, probe, migrations };
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

type Ctx = {
  sub: Sub;
  args: ParsedArgs;
  cfg: CutoverConfig;
  statePath: string;
  logPath: string;
  coolifyUrl: string;
  fake: FakeMode | null;
  fakeApi: FakeCoolify | null;
};

function printPlan(cfg: CutoverConfig): void {
  console.log(`Cutover plan · ${cfg.apex}`);
  for (const s of cutoverPlan(cfg))
    console.log(`  ${s.n}. ${s.key}: ${s.text}`);
}

function printRollbackPlan(cfg: CutoverConfig): void {
  console.log(`Rollback plan · ${cfg.apex}`);
  console.log(
    `  1. rollback-prod-domains: prod domains -> ${cfg.prodSslipUrl}.`,
  );
  console.log(
    "  2. rollback-redeploy-prod: deploy prod (force=false), wait until it finished, so the proxy drops its apex routes.",
  );
  console.log("  3. rollback-old-domains: old app domains -> the saved value.");
  console.log(
    "  4. rollback-deploy-old: deploy the old app (force=false), wait until it finished.",
  );
  console.log(
    `  5. rollback-verify-old: poll https://${cfg.apex}/ until it answers 200 from the old site (no hub marker).`,
  );
}

function expectSha(ctx: Ctx): string | undefined {
  const flag = ctx.args.get("--expect-sha");
  if (typeof flag === "string") {
    if (!/^[0-9a-f]{7,40}$/i.test(flag))
      fail("--expect-sha must be a commit sha");
    return flag;
  }
  if (ctx.fake) return undefined;
  const git = (ref: string) => {
    const r = spawnSync("git", ["rev-parse", "--verify", "-q", ref], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return r.status === 0 ? r.stdout.trim() : "";
  };
  const origin = git("origin/main");
  if (origin) return origin;
  const head = git("HEAD");
  if (head) {
    console.log("WARN  no origin/main: expecting HEAD's commit instead");
    return head;
  }
  console.log("WARN  no git commit found: the health version is not checked");
  return undefined;
}

function buildDeps(ctx: Ctx): CutoverDeps {
  // The console line comes first, so a failed runbook write (EBUSY/EPERM) loses nothing the
  // operator sees; the planner also treats the sink as best-effort (WR-B03).
  const log = (line: string) => {
    console.log(`  ${line}`);
    try {
      appendRunLog(ctx.logPath, runLogLine(ctx.sub, line));
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      console.log(
        `  WARN  Run log not written (${typeof code === "string" ? code : "error"}); add the line above by hand.`,
      );
    }
  };
  const base = {
    cfg: ctx.cfg,
    state: fileState(ctx.statePath),
    log,
    now: () => new Date(),
    readiness: readiness(ctx.args.has("--mailboxes-ready")),
  };
  if (ctx.fake) {
    const w = fakeWorld(ctx.fake, ctx.cfg);
    ctx.fakeApi = w.coolify;
    return {
      ...base,
      coolify: w.coolify,
      resolver: w.resolver,
      probe: w.probe,
      migrations: w.migrations,
      sleep: async () => undefined,
      verifyAttempts: 2,
      verifyIntervalMs: 0,
      deployAttempts: 3,
      deployIntervalMs: 0,
    };
  }
  const token = readCoolifyToken({ cwd: REPO_ROOT });
  if (!token) {
    fail(
      "no Coolify token: put it in ~/.coolify_api_token or .env.local COOLIFY_API_TOKEN",
    );
  }
  console.log(`Coolify API: ${ctx.coolifyUrl}`);
  if (ctx.args.has("--insecure-http") && !isSecureCoolifyUrl(ctx.coolifyUrl)) {
    console.log(
      "WARN  --insecure-http: the Coolify token travels in cleartext. Prefer the SSH tunnel.",
    );
  }
  const coolify: CoolifyApi = coolifyApi({
    token,
    baseUrl: ctx.coolifyUrl,
    allowInsecureHttp: ctx.args.has("--insecure-http"),
  });
  return {
    ...base,
    coolify,
    resolver: publicResolver(),
    probe: httpsProbe(),
    migrations: sshMigrations(ctx.cfg),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function printRows(rows: CheckRow[]): {
  fail: number;
  warn: number;
  pass: number;
} {
  console.log(
    table(
      ["status", "check", "detail", "fix"],
      rows.map((r) => [r.status, r.id, r.label, r.hint]),
    ),
  );
  const n = (s: CheckRow["status"]) =>
    rows.filter((r) => r.status === s).length;
  const counts = { pass: n("PASS"), warn: n("WARN"), fail: n("FAIL") };
  console.log("");
  console.log(
    `${counts.pass} PASS · ${counts.warn} WARN · ${counts.fail} FAIL`,
  );
  return counts;
}

async function confirmApex(ctx: Ctx, what: string): Promise<string> {
  const hook = ctx.args.get("--confirm");
  if (typeof hook === "string") return hook;
  if (ctx.args.has("--yes")) return ctx.cfg.apex;
  return ask(`${what} Type the domain to continue (${ctx.cfg.apex}): `);
}

async function cmdCheck(ctx: Ctx): Promise<void> {
  const deps = buildDeps(ctx);
  const sha = expectSha(ctx);
  console.log(`Cutover check · ${ctx.cfg.apex}`);
  const rows = await preflight(deps, { expectSha: sha });
  const c = printRows(rows);
  appendRunLog(
    ctx.logPath,
    `- ${stampNow(new Date())} · check · ${c.pass} PASS, ${c.warn} WARN, ${c.fail} FAIL · ${
      c.fail === 0 ? "ok" : "failed"
    }`,
  );
  console.log(
    `${READ_ONLY} (Coolify, DNS and PocketBase untouched; one line added to the Run log.)`,
  );
  if (c.fail > 0) throw new CliFail(`check: ${c.fail} FAIL.`, { plain: true });
}

async function cmdApply(ctx: Ctx): Promise<void> {
  const deps = buildDeps(ctx);
  const sha = expectSha(ctx);
  console.log(`Cutover check · ${ctx.cfg.apex}`);
  const rows = await preflight(deps, { expectSha: sha });
  const c = printRows(rows);
  if (c.fail > 0) {
    appendRunLog(
      ctx.logPath,
      `- ${stampNow(new Date())} · apply · preflight · failed`,
    );
    throw new CliFail(
      `Refused: preflight has ${c.fail} FAIL. Fix them (see docs/ops/hub-cutover.md); nothing was changed.`,
      { plain: true },
    );
  }
  console.log("");
  printPlan(ctx.cfg);
  console.log("");
  const confirm = await confirmApex(ctx, "This moves the live domain.");
  let result;
  try {
    result = await applyCutover(deps, { confirm, expectSha: sha });
  } catch (e) {
    if (e instanceof CutoverRefused) {
      throw new CliFail(`Refused: ${e.message} Nothing was changed.`, {
        plain: true,
      });
    }
    throw e;
  }
  if (result.ok) {
    console.log(
      `Cutover done. ${ctx.cfg.apex} and ${ctx.cfg.www} serve the hub; the old app is stopped (not deleted). Saved state: ${ctx.statePath}`,
    );
    return;
  }
  if (result.rolledBack) {
    const rb = result.rollback;
    throw new CliFail(
      `Cutover failed at ${result.failedStep}; rolled back ${
        rb && rb.ok
          ? "cleanly"
          : `with failures: ${rb?.failed.join(", ") ?? "unknown"}`
      }. See docs/ops/hub-cutover.md "Roll back".`,
      { plain: true },
    );
  }
  throw new CliFail(
    `Cutover live, but ${result.failedStep} failed: stop the old app by hand in Coolify (never delete it).`,
    { plain: true },
  );
}

async function cmdRollback(ctx: Ctx): Promise<void> {
  const store = fileState(ctx.statePath);
  const saved = await store.load();
  if (!saved) fail(`no saved state at ${ctx.statePath}: nothing to roll back`);
  console.log(`Rollback · saved ${saved.at}`);
  console.log(`  old app domains back to: ${saved.oldFqdn}`);
  console.log(`  prod domains back to:    ${ctx.cfg.prodSslipUrl}`);
  printRollbackPlan(ctx.cfg);
  const deps = buildDeps(ctx);
  const confirm = await confirmApex(ctx, "This moves the live domain back.");
  if (confirm !== ctx.cfg.apex) {
    throw new CliFail(
      `Refused: type the apex (${ctx.cfg.apex}) exactly to confirm. Nothing was changed.`,
      { plain: true },
    );
  }
  const rb = await rollbackCutover(deps, saved);
  if (!rb.ok) {
    throw new CliFail(`Rollback incomplete: ${rb.failed.join(", ")}.`, {
      plain: true,
    });
  }
  console.log(`Rolled back. ${ctx.cfg.apex} answers from the old app again.`);
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const first = argv[0];
  const hasSub = first !== undefined && !first.startsWith("-");
  const rest = hasSub ? argv.slice(1) : argv;
  const args = parseArgs(rest, {
    known: [
      "--dry-run",
      "--yes",
      "--expect-sha",
      "--mailboxes-ready",
      "--state",
      "--log-file",
      "--confirm",
      "--coolify-url",
      "--insecure-http",
    ],
    withValue: [
      "--expect-sha",
      "--state",
      "--log-file",
      "--confirm",
      "--coolify-url",
    ],
  });
  if (wantsHelp(args)) {
    console.log(USAGE);
    return;
  }
  if (!hasSub)
    fail(`a subcommand is required: ${SUBS.join(" | ")} (see --help)`);
  if (!SUBS.includes(first as Sub)) {
    fail(`unknown subcommand ${first.slice(0, 40)} (${SUBS.join(" | ")})`);
  }
  const fake = fakeMode();
  if (args.has("--confirm") && !fake) {
    fail("--confirm is a test hook; type the domain when asked");
  }
  if (args.has("--yes") && process.stdin.isTTY) {
    fail("--yes works only in a non-interactive run; type the domain instead");
  }
  const str = (k: string) => {
    const v = args.get(k);
    return typeof v === "string" ? resolve(v) : null;
  };
  const coolifyUrl = resolveCoolifyUrl(
    args.get("--coolify-url"),
    args.has("--insecure-http"),
  );
  const paths = fakeSafePaths(fake, str("--state"), str("--log-file"));
  const ctx: Ctx = {
    sub: first as Sub,
    args,
    cfg: HUB_CUTOVER_DEFAULTS,
    statePath: paths.statePath,
    logPath: paths.logPath,
    coolifyUrl,
    fake,
    fakeApi: null,
  };
  try {
    if (ctx.sub === "plan") {
      printPlan(ctx.cfg);
      console.log(DRY);
      return;
    }
    if (args.has("--dry-run")) {
      if (ctx.sub === "rollback") printRollbackPlan(ctx.cfg);
      else printPlan(ctx.cfg);
      console.log(DRY);
      return;
    }
    if (ctx.sub === "check") await cmdCheck(ctx);
    else if (ctx.sub === "apply") await cmdApply(ctx);
    else await cmdRollback(ctx);
  } finally {
    if (fake) {
      const calls = ctx.fakeApi?.calls ?? [];
      const writes = calls.filter((c) =>
        (COOLIFY_WRITE_METHODS as readonly string[]).includes(c.method),
      );
      console.log(
        `[fake] coolify calls: ${calls.length} (writes ${writes.length})`,
      );
    }
    if (paths.tempDir) rmSync(paths.tempDir, { recursive: true, force: true });
  }
}

/**
 * WR-B05: the Coolify API base. Default is the SSH tunnel on loopback; https is fine; plain
 * http to any other host is refused unless --insecure-http opts in. Checked before any call.
 */
export function resolveCoolifyUrl(
  flag: string | true | undefined,
  insecure: boolean,
): string {
  if (flag === true) fail("--coolify-url needs a URL");
  const url = (flag ?? COOLIFY_BASE_URL).trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("--coolify-url must be a URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("--coolify-url must be http(s)");
  }
  if (!isSecureCoolifyUrl(url) && !insecure) {
    fail(
      `refusing plain http to ${parsed.hostname}: the Coolify token would travel in cleartext. Open the SSH tunnel (${COOLIFY_TUNNEL_COMMAND}) and use the default, or pass --insecure-http`,
    );
  }
  return url;
}

/** Same file on disk (Windows paths compare case-insensitively). */
function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

/**
 * WR-B04: fake mode swaps every port except the state file and the run log, so it must never
 * reach the real ones: `.planning/tmp/cutover-state.json` is what a real rollback reads, and
 * the runbook's Run log is the audit trail. A missing path defaults to a throwaway temp dir
 * (removed at exit); naming either real file is refused.
 */
export function fakeSafePaths(
  fake: unknown,
  state: string | null,
  log: string | null,
): { statePath: string; logPath: string; tempDir: string | null } {
  if (!fake) {
    return {
      statePath: state ?? DEFAULT_STATE,
      logPath: log ?? DEFAULT_RUNBOOK,
      tempDir: null,
    };
  }
  if (state && samePath(state, DEFAULT_STATE)) {
    fail("fake mode never writes the real saved state; pass a temp --state");
  }
  if (log && samePath(log, DEFAULT_RUNBOOK)) {
    fail("fake mode never writes the real runbook; pass a temp --log-file");
  }
  const tempDir =
    state && log ? null : mkdtempSync(join(tmpdir(), "hub-cutover-fake-"));
  return {
    statePath: state ?? join(tempDir!, "cutover-state.json"),
    logPath: log ?? join(tempDir!, "runbook.md"),
    tempDir,
  };
}

// Exported for tests; runs only when executed directly (node … hub-cutover.ts).
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  runMain(() => main());
}
