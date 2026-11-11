import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleMigrationsDir } from "../scripts/migrations-dir.mjs";

// Throwaway PocketBase 0.39.11 for every P2 *.integration.test.ts (TEN-01/03/05/09, D286).
// Boots on a free loopback port with fresh migrations and a per-boot superuser. PB exits 0
// on failure (RESEARCH Pitfall 6), so CLI steps assert on output text, never exit codes.
// Windows (Pitfall 7): spawn the binary directly, kill per PID, never by image name.
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = join(PKG_DIR, "pb_hooks");
const FETCH_SCRIPT = join(PKG_DIR, "scripts", "fetch-pocketbase.mjs");
const SKIP_MESSAGE = "PocketBase binary not available offline";
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const BOOT_TIMEOUT_MS = 20_000;

export type PbInstance = {
  url: string;
  email: string;
  password: string;
  /** PB_APP_KEY shared by the PB process and the app (users auth guard hook, review CR-01). */
  appKey: string;
  /** Everything the child wrote to stdout + stderr so far (plan 06 reads OTP codes here). */
  stdout(): string;
  stop(): Promise<void>;
};

function resolveBinary(): string | null {
  const fetched = spawnSync(process.execPath, [FETCH_SCRIPT, "--print-path"], {
    encoding: "utf8",
  });
  if (fetched.status === 0 && fetched.stdout.trim()) {
    return fetched.stdout.trim();
  }
  return null;
}

function runCli(bin: string, args: string[]): string {
  const result = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(ANSI, "");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`PocketBase exited early (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  throw new Error(
    `PocketBase did not become healthy within ${BOOT_TIMEOUT_MS} ms`,
  );
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill();
  const timedOut = await Promise.race([
    exited.then(() => false),
    sleep(5_000).then(() => true),
  ]);
  if (timedOut && child.pid !== undefined) {
    if (process.platform === "win32") {
      // Per-PID only: never kill unrelated PocketBase instances.
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    } else {
      child.kill("SIGKILL");
    }
    await Promise.race([exited, sleep(5_000)]);
  }
}

async function removeDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
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

async function superuserToken(
  url: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch(
    `${url}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    },
  );
  if (!res.ok) throw new Error(`superuser auth failed: HTTP ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/**
 * Boot a throwaway PocketBase. Returns null only when the binary is unavailable and CI is
 * unset (the caller then calls ctx.skip()); in CI a missing binary is a failure.
 */
export async function bootPb(
  opts: { rateLimits?: boolean } = {},
): Promise<PbInstance | null> {
  const bin = resolveBinary();
  if (!bin) {
    if (process.env.CI) {
      throw new Error(`${SKIP_MESSAGE} (CI is set, so this is a failure)`);
    }
    console.warn(`${SKIP_MESSAGE}; integration test SKIPPED`);
    return null;
  }

  const dir = mkdtempSync(join(tmpdir(), "cds-pb-harness-"));
  const email = "harness@cds.test";
  const password = randomBytes(16).toString("hex");
  const appKey = randomBytes(24).toString("hex");
  let child: ChildProcess | undefined;

  try {
    // Core + add-on migrations assembled once per boot (ADDON-03, RESEARCH Pattern 4).
    const migrationsDir = join(dir, "migrations");
    assembleMigrationsDir(migrationsDir);
    const up = runCli(bin, [
      "migrate",
      "up",
      `--dir=${dir}`,
      `--migrationsDir=${migrationsDir}`,
      "--automigrate=false",
    ]);
    if (/error|failed|panic/i.test(up)) {
      throw new Error(`migrate up failed:\n${up.trim()}`);
    }

    const upsert = runCli(bin, [
      "superuser",
      "upsert",
      email,
      password,
      `--dir=${dir}`,
    ]);
    if (!upsert.includes("Successfully saved superuser")) {
      throw new Error("superuser upsert failed");
    }

    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    let output = "";
    const proc = spawn(
      bin,
      [
        "serve",
        `--http=127.0.0.1:${port}`,
        `--dir=${dir}`,
        `--migrationsDir=${migrationsDir}`,
        `--hooksDir=${HOOKS_DIR}`,
        "--automigrate=false",
      ],
      { env: { ...process.env, CDS_OTP_STANDIN: "1", PB_APP_KEY: appKey } },
    );
    child = proc;
    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    await waitForHealth(url, proc);

    if (!opts.rateLimits) {
      const token = await superuserToken(url, email, password);
      const res = await fetch(`${url}/api/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json", Authorization: token },
        body: JSON.stringify({ rateLimits: { enabled: false } }),
      });
      if (!res.ok) {
        throw new Error(`disabling rate limits failed: HTTP ${res.status}`);
      }
    }

    process.env.PB_URL = url;
    process.env.PB_SUPERUSER_EMAIL = email;
    process.env.PB_SUPERUSER_PASSWORD = password;
    process.env.PB_APP_KEY = appKey;

    let stopped = false;
    return {
      url,
      email,
      password,
      appKey,
      stdout: () => output.replace(ANSI, ""),
      stop: async () => {
        if (stopped) return;
        stopped = true;
        await killChild(proc);
        await removeDir(dir);
      },
    };
  } catch (err) {
    if (child) await killChild(child);
    await removeDir(dir);
    throw err;
  }
}
