#!/usr/bin/env node
// Push repo migrations and JSVM hooks to the DEV PocketBase (container pocketbase-cdsp)
// and self-verify. Hooks (packages/db/pb_hooks/*.pb.js) go to /root/pocketbase-cdsp/pb_hooks/,
// which the container already mounts as --hooksDir; both copies happen before the restart.
//
// Usage:
//   npm run db:migrate:dev              scp + restart + verify
//   node packages/db/scripts/migrate-dev.mjs --dry-run   print the plan, change nothing
//
// Safety (T-01-10): the target container is hard-coded. The data VPS also runs
// pocketbase-cds, the old marketing site's LIVE database. Naming any other container,
// by --container or CDS_PB_CONTAINER, is refused.
// Secrets (T-01-11): superuser credentials are parsed from .env.local in-process, sent only
// in an HTTPS request body, and never printed or passed on a command line.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationFiles } from "./migrations-dir.mjs";

const TARGET_CONTAINER = "pocketbase-cdsp";
const SSH_HOST = "pocketbase-cds"; // ssh alias for the data VPS (not the container name)
const REMOTE_DIR = "/root/pocketbase-cdsp/pb_data/pb_migrations/";
const REMOTE_HOOKS_DIR = "/root/pocketbase-cdsp/pb_hooks/";
const REMOTE_DB = "/root/pocketbase-cdsp/pb_data/data.db";
const PB_URL = "https://api.cds.needtobeedgy.com";
const HEALTH_TIMEOUT_S = 90;
// Unattended runs must fail, never hang (WR-02, review iteration 2): no prompts
// (host key, passphrase, password), a bounded connect, and a hard cap per call.
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
const REMOTE_CALL_TIMEOUT_MS = 120_000;

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PKG_DIR, "..", "..");
const HOOKS_DIR = join(PKG_DIR, "pb_hooks");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function requestedContainers() {
  const names = [];
  args.forEach((arg, i) => {
    if (arg === "--container") names.push(args[i + 1] ?? "");
    else if (arg.startsWith("--container=")) names.push(arg.slice(12));
  });
  if (process.env.CDS_PB_CONTAINER !== undefined) {
    names.push(process.env.CDS_PB_CONTAINER);
  }
  return names;
}

for (const name of requestedContainers()) {
  if (name !== TARGET_CONTAINER) {
    fail(
      `refusing: only ${TARGET_CONTAINER} is allowed (got "${name}"). Never touch pocketbase-cds.`,
    );
  }
}

// Core + packages/addons/*/migrations, one ordered list (ADDON-03); scp takes many sources.
let files;
try {
  files = migrationFiles();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
if (files.length === 0)
  fail("no migrations found in packages/db/pb_migrations");

const localNames = files.map((f) => basename(f));

// Only *.pb.js are hooks; .gitkeep and anything else stay local.
const hookFiles = existsSync(HOOKS_DIR)
  ? readdirSync(HOOKS_DIR)
      .filter((f) => f.endsWith(".pb.js"))
      .sort()
      .map((f) => join(HOOKS_DIR, f))
  : [];

// Restart and print the remote UTC timestamp taken just before it, so the log check
// below reads only this start (never older output), and in full rather than a tail.
const restartCmd = `date -u +%Y-%m-%dT%H:%M:%SZ && docker restart ${TARGET_CONTAINER} >/dev/null`;
const logsCmd = (since) =>
  `docker logs --since ${since} ${TARGET_CONTAINER} 2>&1`;
// Applied migrations, read from PocketBase's _migrations table (read-only open).
const appliedCmd = `python3 -c "import sqlite3; c = sqlite3.connect('file:${REMOTE_DB}?mode=ro', uri=True); print('\\n'.join(r[0] for r in c.execute('select file from _migrations')))"`;
const scpArgs = [...files, `${SSH_HOST}:${REMOTE_DIR}`];
const scpHooksArgs = [...hookFiles, `${SSH_HOST}:${REMOTE_HOOKS_DIR}`];

if (dryRun) {
  console.log(`DRY RUN target container: ${TARGET_CONTAINER}`);
  console.log(
    `DRY RUN every ssh/scp call: ${SSH_OPTS.join(" ")}, timeout ${REMOTE_CALL_TIMEOUT_MS / 1000}s`,
  );
  console.log(`DRY RUN scp ${[...SSH_OPTS, ...scpArgs].join(" ")}`);
  if (hookFiles.length > 0) {
    console.log(`DRY RUN scp ${[...SSH_OPTS, ...scpHooksArgs].join(" ")}`);
  } else {
    console.log("DRY RUN no pb_hooks/*.pb.js to copy");
  }
  console.log(
    `DRY RUN ssh ${[...SSH_OPTS, SSH_HOST].join(" ")} "${restartCmd}"`,
  );
  console.log(
    `DRY RUN poll ${PB_URL}/api/health (up to ${HEALTH_TIMEOUT_S}s), then ssh ${SSH_HOST} "${logsCmd("<restart-ts>")}"`,
  );
  console.log(
    `DRY RUN verify every local migration is in ${REMOTE_DB} _migrations: ${localNames.join(", ")}`,
  );
  console.log(
    `DRY RUN verify superuser GET ${PB_URL}/api/collections/platform_meta`,
  );
  process.exit(0);
}

function readEnvLocal() {
  const path = join(REPO_ROOT, ".env.local");
  if (!existsSync(path)) fail(".env.local not found at repo root");
  const env = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

// A spawn error (ETIMEDOUT, ENOENT) or a non-zero exit fails the named step.
function checkRemote(step, run) {
  if (run.error) fail(`${step}: ${run.error.code ?? run.error.message}`);
  if (run.status !== 0) {
    const stderr = typeof run.stderr === "string" ? run.stderr.trim() : "";
    fail(
      `${step} (exit ${run.status ?? run.signal})${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return run;
}

checkRemote(
  `scp to ${SSH_HOST}:${REMOTE_DIR}`,
  spawnSync("scp", [...SSH_OPTS, ...scpArgs], {
    stdio: "inherit",
    timeout: REMOTE_CALL_TIMEOUT_MS,
  }),
);
console.log(`PASS copied ${files.length} migration(s) to ${REMOTE_DIR}`);

if (hookFiles.length > 0) {
  checkRemote(
    `scp to ${SSH_HOST}:${REMOTE_HOOKS_DIR}`,
    spawnSync("scp", [...SSH_OPTS, ...scpHooksArgs], {
      stdio: "inherit",
      timeout: REMOTE_CALL_TIMEOUT_MS,
    }),
  );
  console.log(
    `PASS copied ${hookFiles.length} hook(s) to ${REMOTE_HOOKS_DIR}: ${hookFiles.map((f) => basename(f)).join(", ")}`,
  );
}

function ssh(step, cmd) {
  return checkRemote(
    step,
    spawnSync("ssh", [...SSH_OPTS, SSH_HOST, cmd], {
      encoding: "utf8",
      timeout: REMOTE_CALL_TIMEOUT_MS,
    }),
  );
}

const restart = ssh(`restart ${TARGET_CONTAINER}`, restartCmd);
const restartedAt = (restart.stdout ?? "").trim().split(/\r?\n/)[0];
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(restartedAt ?? "")) {
  fail(`could not read the remote restart timestamp (got "${restartedAt}")`);
}
console.log(`PASS restarted ${TARGET_CONTAINER} at ${restartedAt}`);

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_S * 1000;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${PB_URL}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status === 200) return;
      last = `status ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  fail(`GET /api/health not 200 within ${HEALTH_TIMEOUT_S}s (${last})`);
}

async function verify() {
  await waitForHealth();
  console.log("PASS /api/health 200");

  const logsRun = ssh(`read ${TARGET_CONTAINER} logs`, logsCmd(restartedAt));
  const logs = logsRun.stdout ?? "";
  if (/error|failed|panic/i.test(logs)) {
    console.error(logs);
    fail(`${TARGET_CONTAINER} logs report an error since ${restartedAt}`);
  }
  console.log(`PASS no errors in ${TARGET_CONTAINER} logs since restart`);

  const appliedRun = ssh(`read _migrations from ${REMOTE_DB}`, appliedCmd);
  const applied = new Set(
    (appliedRun.stdout ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const missing = localNames.filter((name) => !applied.has(name));
  if (missing.length > 0) {
    fail(`migration(s) not applied: ${missing.join(", ")}`);
  }
  console.log(`PASS all ${localNames.length} migration(s) applied`);

  const env = readEnvLocal();
  const identity = env.PB_SUPERUSER_EMAIL;
  const secret = env.PB_SUPERUSER_PASSWORD;
  if (!identity || !secret) {
    fail("PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD missing in .env.local");
  }

  const auth = await fetch(
    `${PB_URL}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity, password: secret }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (auth.status !== 200) fail(`superuser auth returned ${auth.status}`);
  const { token: authToken } = await auth.json();
  console.log("PASS superuser auth");

  const meta = await fetch(`${PB_URL}/api/collections/platform_meta`, {
    headers: { authorization: authToken },
    signal: AbortSignal.timeout(15_000),
  });
  if (meta.status !== 200) {
    fail(`GET /api/collections/platform_meta returned ${meta.status}`);
  }
  console.log("PASS platform_meta collection exists");
}

verify().catch((err) =>
  fail(`verification error: ${err instanceof Error ? err.message : err}`),
);
