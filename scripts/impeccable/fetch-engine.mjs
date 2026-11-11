#!/usr/bin/env node
// Download the pinned impeccable engine binary into <repo>/.impeccable-bin/<version>/,
// verified by sha256 against a hash pinned in this file, with the release's
// <asset>.sha256 sidecar as a cross-check (THEME-04, D48, CONTEXT A4-Q1, T-04-06).
// Idempotent: an existing binary is reused only if it still matches the hash recorded
// when it was installed. Same pattern as packages/db/scripts/fetch-pocketbase.mjs.
//
// Usage:
//   node scripts/impeccable/fetch-engine.mjs               ensure binary, human status
//   node scripts/impeccable/fetch-engine.mjs --print-path  print only the binary path
//     (exit 0), or the failure reason on stderr (exit 2)
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_VERSION = "0.1.5";

// Pinned sha256 of each raw release binary, recorded from the engine-v0.1.5
// <asset>.sha256 sidecars on 2026-09-27 (linux-x64 and windows-x64 also match
// 04-RESEARCH "Package Legitimacy Audit"). The download is verified against THIS table,
// so a replaced release asset (and a matching replaced sidecar) is caught. The sidecar is
// still fetched as a cross-check. Bump both constants together.
// One pin per line keeps each target greppable.
// prettier-ignore
export const ENGINE_SHA256 = {
  "darwin-arm64": "0d48b6e16aa97664fdbe607d5da9ae320e389a1843e0ff1328f8c2530530320d",
  "darwin-x64": "153971b0c00719dff9ebac13370cb7dbbbe12838b696fbaf3f7ab0b1b3726b52",
  "linux-arm64": "bc4fa28bc8ccbb018795a99a4ece95ada898a6f1885f14281389d0e6ef2a2f98",
  "linux-x64": "cf5231a4b1ae66996c85b033800b1dad0797e590eae2f21ef2579430af187f19",
  "windows-x64": "477e544fc8880a5e82e427490cb9a5f5adab480c0e02966d33fd50772b531c71",
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OS_MAP = { win32: "windows", linux: "linux", darwin: "darwin" };
const ARCH_MAP = { x64: "x64", arm64: "arm64" };

/** Release asset name for a target key: raw binaries, `.exe` on Windows. */
export function assetName(target) {
  return `impeccable-${target}${target.startsWith("windows-") ? ".exe" : ""}`;
}

function target() {
  const os = OS_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  if (!os || !arch) {
    throw new Error(`unsupported platform ${process.platform}/${process.arch}`);
  }
  const key = `${os}-${arch}`;
  const pinned = ENGINE_SHA256[key];
  if (!pinned) throw new Error(`no pinned sha256 for ${key}`);
  const exe = os === "windows" ? "impeccable.exe" : "impeccable";
  return {
    pinned,
    asset: assetName(key),
    binPath: join(REPO_ROOT, ".impeccable-bin", ENGINE_VERSION, exe),
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Hash from an <asset>.sha256 sidecar: "<hash>  <asset>" (exact name) or a bare "<hash>".
 * Returns null for another asset's line or a malformed hash.
 */
export function checksumFor(sidecarText, asset) {
  for (const l of sidecarText.split(/\r?\n/)) {
    const [hash, name] = l.trim().split(/\s+/);
    if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) continue;
    if (name === undefined || name.replace(/^\*/, "") === asset) {
      return hash.toLowerCase();
    }
  }
  return null;
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Ensure the verified engine binary exists; returns its absolute path. */
export async function ensureEngine(log = () => {}) {
  const { pinned, asset, binPath } = target();
  const sumPath = `${binPath}.sha256`;
  if (existsSync(binPath)) {
    const recorded = existsSync(sumPath)
      ? readFileSync(sumPath, "utf8").trim()
      : null;
    const actual = sha256(readFileSync(binPath));
    if (recorded === pinned && actual === pinned) {
      log(
        `impeccable ${ENGINE_VERSION} already present (verified): ${binPath}`,
      );
      return binPath;
    }
    log(`Cached binary unverified or changed; re-downloading: ${binPath}`);
    rmSync(binPath, { force: true });
    rmSync(sumPath, { force: true });
  }

  const base = `https://github.com/pbakaus/impeccable/releases/download/engine-v${ENGINE_VERSION}`;
  log(`Downloading ${asset} and ${asset}.sha256 ...`);
  const [bin, sidecar] = await Promise.all([
    download(`${base}/${asset}`),
    download(`${base}/${asset}.sha256`),
  ]);

  // Abort before writing on any mismatch: never execute an unverified binary.
  const actual = sha256(bin);
  if (actual !== pinned) {
    throw new Error(
      `sha256 mismatch for ${asset}: pinned ${pinned}, got ${actual}`,
    );
  }
  const listed = checksumFor(new TextDecoder().decode(sidecar), asset);
  if (listed !== pinned) {
    throw new Error(
      `${asset}.sha256 disagrees with the pinned sha256: listed ${listed ?? "none"}`,
    );
  }
  log(`sha256 verified against pinned value and sidecar: ${actual}`);

  mkdirSync(dirname(binPath), { recursive: true });
  const tmp = `${binPath}.tmp-${process.pid}`;
  writeFileSync(tmp, bin);
  if (process.platform !== "win32") chmodSync(tmp, 0o755);
  renameSync(tmp, binPath);
  writeFileSync(sumPath, `${actual}\n`);
  log(`impeccable ${ENGINE_VERSION} installed: ${binPath}`);
  return binPath;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const printPath = process.argv.includes("--print-path");
  try {
    const binPath = await ensureEngine(
      printPath ? () => {} : (m) => console.log(m),
    );
    if (printPath) process.stdout.write(`${binPath}\n`);
  } catch (err) {
    process.stderr.write(
      `fetch-engine: ${err instanceof Error ? err.message : err}\n`,
    );
    process.exit(2);
  }
}
