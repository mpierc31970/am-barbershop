// Restore rehearsal (13-05; STAFF-13, D154, D171). Proves the nightly DB backup restores:
// take the newest backup zip, restore it into a throwaway PocketBase (the pinned binary, as
// packages/db/test/pb-harness.ts boots it), count collections and rows, read the newest
// applied migration, then record the result.
//
// Usage:
//   npm run db:restore-rehearse -- --from-ssh pocketbase-cds   newest dev backup over SSH
//   npm run db:restore-rehearse -- --zip <file>                a local backup zip
//   npm run db:restore-rehearse -- ... --dry-run               rehearse, record nothing
//   npm run db:restore-rehearse -- ... --keep                  keep the temp dir
//   npm run db:restore-rehearse -- --help
//
// Safety (RESEARCH Pitfall 16, T-13-05-01..03): `pocketbase-cds` here is the data VPS SSH
// alias. The script only lists and scp's /root/pocketbase-cdsp/backups/cdsp-*.zip, read-only.
// It never runs a command inside a container and never talks to a remote database other than
// the record target (PB_URL). The restored copy lives in a temp dir that is deleted unless
// --keep; the throwaway superuser password is random per run and never printed. Output is
// counts only: no org names, emails or record content.
//
// Record (default; skipped by --dry-run): platform_meta `backup:restore_rehearsed_at` (ISO)
// and `backup:restore_rehearsal_counts` (JSON) on PB_URL (monitor check 40), plus a dated line
// under `## Rehearsals` in docs/ops/restore-rehearsal.md.
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (record target; required unless
// --dry-run). .env.local is read by the npm script.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BACKUP_DIR = "/root/pocketbase-cdsp/backups/";
export const BACKUP_PREFIX = `${BACKUP_DIR}cdsp-`;
const BACKUP_NAME = /^cdsp-\d{8}-\d{6}\.zip$/;
const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
export const DEFAULT_SSH_ALIAS = "pocketbase-cds";
export const KEY_AT = "backup:restore_rehearsed_at";
export const KEY_COUNTS = "backup:restore_rehearsal_counts";

const REPO_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const FETCH_SCRIPT = join(
  REPO_DIR,
  "packages",
  "db",
  "scripts",
  "fetch-pocketbase.mjs",
);
export const RUNBOOK = join(REPO_DIR, "docs", "ops", "restore-rehearsal.md");
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const BOOT_TIMEOUT_MS = 30_000;

export const USAGE = `db:restore-rehearse - prove the DB backup restores (STAFF-13, D154)

  npm run db:restore-rehearse -- --from-ssh pocketbase-cds
        newest /root/pocketbase-cdsp/backups/cdsp-*.zip from the data VPS (scp, read-only)
  npm run db:restore-rehearse -- --zip <file>
        a backup zip already on this machine
  options:
    --dry-run   rehearse, but write nothing (no platform_meta, no runbook line)
    --record    record the result (the default unless --dry-run)
    --keep      keep the temp dir with the restored copy (holds real data: delete it after)
    --help      this text

Restores into a throwaway pinned PocketBase, counts collections and rows, reads the newest
applied migration, prints one counts line. Records ${KEY_AT} and
${KEY_COUNTS} on PB_URL and a dated line in docs/ops/restore-rehearsal.md.
Runbook: docs/ops/restore-rehearsal.md
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required unless --dry-run)`;

export type RehearseArgs = {
  help: boolean;
  zip: string | null;
  fromSsh: string | null;
  keep: boolean;
  record: boolean;
  dryRun: boolean;
};

export class RehearseArgError extends Error {
  override name = "RehearseArgError";
}

/** Parse argv (after the script name). Throws RehearseArgError on any refusal. */
export function parseRehearseArgs(args: readonly string[]): RehearseArgs {
  const out: RehearseArgs = {
    help: false,
    zip: null,
    fromSsh: null,
    keep: false,
    record: false,
    dryRun: false,
  };
  let sawRecord = false;
  let sawSsh = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--keep") out.keep = true;
    else if (a === "--record") sawRecord = true;
    else if (a === "--zip") {
      const v = args[i + 1];
      if (!v || v.startsWith("--"))
        throw new RehearseArgError("--zip needs a file path");
      out.zip = v;
      i++;
    } else if (a === "--from-ssh") {
      sawSsh = true;
      const v = args[i + 1];
      if (v && !v.startsWith("--")) {
        out.fromSsh = v;
        i++;
      } else {
        out.fromSsh = DEFAULT_SSH_ALIAS;
      }
    } else {
      throw new RehearseArgError(`unknown argument ${a}`);
    }
  }
  if (out.help) return out;
  if (out.zip && sawSsh) {
    throw new RehearseArgError("use --zip or --from-ssh, not both");
  }
  if (!out.zip && !sawSsh) {
    throw new RehearseArgError(
      "pick a backup: --zip <file> or --from-ssh <alias>",
    );
  }
  if (out.fromSsh !== null && !SSH_ALIAS.test(out.fromSsh)) {
    throw new RehearseArgError("--from-ssh takes an SSH host alias");
  }
  if (sawRecord && out.dryRun) {
    throw new RehearseArgError("--record and --dry-run contradict each other");
  }
  out.record = !out.dryRun;
  return out;
}

/** Newest `cdsp-YYYYMMDD-HHMMSS.zip` by name (names sort by time), or null. */
export function newestBackup(names: readonly string[]): string | null {
  const ok = names.map((n) => n.trim()).filter((n) => BACKUP_NAME.test(n));
  ok.sort();
  return ok.length > 0 ? ok[ok.length - 1]! : null;
}

/** Refuse any remote path that is not a dev backup zip (T-13-05-01). */
export function assertBackupPath(remotePath: string): void {
  if (
    !remotePath.startsWith(BACKUP_PREFIX) ||
    !BACKUP_NAME.test(remotePath.slice(BACKUP_DIR.length))
  ) {
    throw new RehearseArgError(
      `refused: only ${BACKUP_PREFIX}*.zip may be copied`,
    );
  }
}

/** 1204 -> "1 204" (space-grouped, as in the UI-SPEC CLI output). */
export function formatCount(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export type RehearsalResult = {
  zip: string;
  collections: number;
  rows: number;
  newestMigration: string | null;
  ok: boolean;
};

/** `Restore rehearsal · cdsp-….zip · 63 collections · 1 204 rows · newest migration … · OK`. */
export function formatRehearsal(r: RehearsalResult): string {
  return [
    "Restore rehearsal",
    r.zip,
    `${formatCount(r.collections)} collections`,
    `${formatCount(r.rows)} rows`,
    `newest migration ${r.newestMigration ?? "unknown"}`,
    r.ok ? "OK" : "FAILED",
  ].join(" · ");
}

/** The dated runbook line: `- 2026-10-13 · Restore rehearsal · … · OK`. */
export function rehearsalLogLine(r: RehearsalResult, now: Date): string {
  return `- ${now.toISOString().slice(0, 10)} · ${formatRehearsal(r)}`;
}

// ------------------------------------------------------------------ runtime

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Explicit env for the throwaway PocketBase: OS basics only, so the record target's
 * credentials (PB_SUPERUSER_*, PB_APP_KEY) never reach the restored copy.
 */
function pbEnv(): NodeJS.ProcessEnv {
  const keep = [
    "PATH",
    "Path",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep)
    if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

function run(cmd: string, args: string[], timeout = 120_000) {
  const res = spawnSync(cmd, args, { encoding: "utf8", timeout });
  return {
    ok: !res.error && res.status === 0,
    stdout: res.stdout ?? "",
    error: res.error ? res.error.name : null,
  };
}

/** Pick and scp the newest dev backup into `dir`. Returns the local path. */
function fetchOverSsh(alias: string, dir: string): string {
  const ls = run(
    "ssh",
    ["-o", "BatchMode=yes", "--", alias, "ls", "-1", BACKUP_DIR],
    60_000,
  );
  if (!ls.ok)
    throw new Error(`ssh listing failed (${ls.error ?? "exit code"})`);
  const name = newestBackup(ls.stdout.split(/\r?\n/));
  if (!name) throw new Error(`no cdsp-*.zip in ${BACKUP_DIR}`);
  const remote = `${BACKUP_DIR}${name}`;
  assertBackupPath(remote);
  const local = join(dir, name);
  const cp = run(
    "scp",
    ["-q", "-o", "BatchMode=yes", `${alias}:${remote}`, local],
    300_000,
  );
  if (!cp.ok || !existsSync(local)) {
    throw new Error(`scp failed (${cp.error ?? "exit code"})`);
  }
  return local;
}

/**
 * Unzip with the system tar (bsdtar reads zip: Windows 10+ System32\tar.exe, macOS, Linux
 * bsdtar), else `unzip`. GNU tar cannot read zip, so on Windows System32\tar.exe is used by
 * full path (Git Bash puts GNU tar first on PATH). Returns the tool used.
 */
function extractZip(zip: string, dest: string): string {
  mkdirSync(dest, { recursive: true });
  const candidates: [string, string[]][] = [];
  if (process.platform === "win32") {
    const sys = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "tar.exe",
    );
    candidates.push([sys, ["-xf", zip, "-C", dest]]);
  } else {
    candidates.push(["bsdtar", ["-xf", zip, "-C", dest]]);
  }
  candidates.push(["unzip", ["-q", "-o", zip, "-d", dest]]);
  candidates.push(["tar", ["-xf", zip, "-C", dest]]);
  for (const [cmd, args] of candidates) {
    const r = run(cmd, args, 300_000);
    if (r.ok && existsSync(join(dest, "data.db"))) return basename(cmd);
  }
  throw new Error("could not extract the backup zip (need bsdtar or unzip)");
}

type SqliteDb = {
  prepare(sql: string): { all(): Record<string, unknown>[] };
  close(): void;
};

/** Newest applied migration timestamp from `_migrations` (node:sqlite, read-only). */
async function newestAppliedMigration(dataDb: string): Promise<string | null> {
  try {
    const mod = (await import("node:sqlite" as string)) as {
      DatabaseSync: new (p: string, o: { readOnly: boolean }) => SqliteDb;
    };
    const db = new mod.DatabaseSync(dataDb, { readOnly: true });
    try {
      const rows = db.prepare("SELECT file FROM _migrations").all();
      const stamps = rows
        .map((r) => /^(\d+)_/.exec(String(r.file ?? ""))?.[1])
        .filter((s): s is string => Boolean(s));
      stamps.sort((a, b) =>
        BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
      );
      return stamps.length > 0 ? stamps[stamps.length - 1]! : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function resolveBinary(): string {
  const r = run(process.execPath, [FETCH_SCRIPT, "--print-path"]);
  const bin = r.stdout.trim();
  if (!r.ok || !bin)
    throw new Error("PocketBase binary missing: run npm run db:pb:fetch");
  return bin;
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const server = createServer();
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      server.close(() => res(port));
    });
  });
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill();
  const timedOut = await Promise.race([
    exited.then(() => false),
    sleep(5_000).then(() => true),
  ]);
  if (timedOut && child.pid !== undefined) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    } else {
      child.kill("SIGKILL");
    }
    await Promise.race([exited, sleep(5_000)]);
  }
}

async function removeDir(dir: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY")
        throw err;
      await sleep(200);
    }
  }
}

async function getJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(`restored PocketBase answered HTTP ${res.status}`);
  return res.json();
}

/** Restore `zip` into `work/pb_data`, boot it, count. Never prints record content. */
async function rehearse(
  zip: string,
  work: string,
): Promise<RehearsalResult & { tool: string }> {
  const bin = resolveBinary();
  const dataDir = join(work, "pb_data");
  const tool = extractZip(zip, dataDir);
  const newestMigration = await newestAppliedMigration(
    join(dataDir, "data.db"),
  );

  const email = `rehearsal-${randomBytes(4).toString("hex")}@cds.test`;
  const password = randomBytes(18).toString("hex");
  const up = spawnSync(
    bin,
    ["superuser", "upsert", email, password, `--dir=${dataDir}`],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: pbEnv(),
    },
  );
  const upOut = `${up.stdout ?? ""}${up.stderr ?? ""}`.replace(ANSI, "");
  if (!upOut.includes("Successfully saved superuser")) {
    throw new Error("superuser upsert on the restored copy failed");
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    bin,
    [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${join(work, "no_migrations")}`,
      `--hooksDir=${join(work, "no_hooks")}`,
      "--automigrate=false",
    ],
    { stdio: "ignore", env: pbEnv() },
  );
  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    for (;;) {
      if (child.exitCode !== null)
        throw new Error("restored PocketBase exited early");
      try {
        const h = await fetch(`${url}/api/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (h.ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline)
        throw new Error("restored PocketBase did not become healthy");
      await sleep(150);
    }
    const auth = await fetch(
      `${url}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identity: email, password }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!auth.ok)
      throw new Error(
        `throwaway superuser sign-in failed: HTTP ${auth.status}`,
      );
    const { token } = (await auth.json()) as { token: string };

    const list = (await getJson(
      `${url}/api/collections?perPage=500`,
      token,
    )) as {
      items: { name: string; type: string }[];
    };
    let collections = 0;
    let rows = 0;
    for (const c of list.items) {
      collections++;
      // Views are derived; _superusers holds the throwaway account added above.
      if (c.type === "view" || c.name === "_superusers") continue;
      const page = (await getJson(
        `${url}/api/collections/${encodeURIComponent(c.name)}/records?perPage=1&fields=id`,
        token,
      )) as { totalItems: number };
      rows += Number(page.totalItems) || 0;
    }
    const ok = collections > 0 && newestMigration !== null;
    return { zip: basename(zip), collections, rows, newestMigration, ok, tool };
  } finally {
    await killChild(child);
  }
}

async function record(r: RehearsalResult, now: Date): Promise<void> {
  const { mintSystemContext } = await import("../src/context");
  const { writePlatformMeta } = await import("../src/platform-meta");
  const ctx = mintSystemContext({ job: "restore-rehearsal" });
  await writePlatformMeta(ctx, KEY_AT, now.toISOString());
  await writePlatformMeta(
    ctx,
    KEY_COUNTS,
    JSON.stringify({
      zip: r.zip,
      collections: r.collections,
      rows: r.rows,
      newest_migration: r.newestMigration,
    }),
  );
  const doc = readFileSync(RUNBOOK, "utf8");
  if (!doc.includes("## Rehearsals"))
    throw new Error("runbook lacks ## Rehearsals");
  // A blank line separates the heading from the first list item (prettier --check).
  const lead = doc.trimEnd().endsWith("## Rehearsals")
    ? "\n".repeat(doc.endsWith("\n\n") ? 0 : doc.endsWith("\n") ? 1 : 2)
    : doc.endsWith("\n")
      ? ""
      : "\n";
  appendFileSync(RUNBOOK, `${lead}${rehearsalLogLine(r, now)}\n`);
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function describeError(err: unknown): string {
  if (err instanceof RehearseArgError) return err.message;
  if (err instanceof Error) {
    return err.name === "ClientResponseError" ? "database error" : err.message;
  }
  return "unknown error";
}

async function main(): Promise<void> {
  const args = parseRehearseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.record) {
    for (const name of [
      "PB_URL",
      "PB_SUPERUSER_EMAIL",
      "PB_SUPERUSER_PASSWORD",
    ]) {
      if (!process.env[name]) fail(`${name} is not set`);
    }
  }
  let zip: string;
  const work = mkdtempSync(join(tmpdir(), "cds-restore-rehearsal-"));
  try {
    if (args.zip) {
      zip = resolve(args.zip);
      if (!existsSync(zip) || !statSync(zip).isFile())
        fail("--zip file not found");
    } else {
      zip = fetchOverSsh(args.fromSsh ?? DEFAULT_SSH_ALIAS, work);
    }
    const result = await rehearse(zip, work);
    console.log(formatRehearsal(result));
    if (!result.ok) fail("the restored copy did not check out");
    if (args.dryRun) {
      console.log("DRY RUN nothing recorded");
    } else {
      await record(result, new Date());
      console.log(
        `Recorded ${KEY_AT} on PB_URL and a line in docs/ops/restore-rehearsal.md`,
      );
    }
  } finally {
    if (args.keep) console.log(`Kept ${work} (real data: delete it when done)`);
    else await removeDir(work);
  }
}

// Exported for tests; runs only when executed directly.
const entry = process.argv[1];
if (
  entry &&
  resolve(entry).toLowerCase() ===
    resolve(fileURLToPath(import.meta.url)).toLowerCase()
) {
  main().catch((err: unknown) => fail(describeError(err)));
}
