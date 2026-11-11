#!/usr/bin/env node
// Download the pinned PocketBase server binary into <repo>/.pocketbase/, verified by sha256
// against a hash pinned in this file, with the release's checksums.txt as a cross-check
// (T-01-09). Idempotent: an existing binary is reused only if it still matches the hash
// recorded when it was installed.
//
// Usage:
//   node packages/db/scripts/fetch-pocketbase.mjs               ensure binary, human status
//   node packages/db/scripts/fetch-pocketbase.mjs --print-path  print only the binary path
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
import { unzipSync } from "fflate";

export const PB_VERSION = "0.39.11";

// Pinned sha256 of each release zip, recorded from the v0.39.11 checksums.txt when the
// version was pinned (2026-09-26). The download is verified against THIS table, so a
// replaced release asset (and a matching replaced checksums.txt) is caught. checksums.txt
// is still fetched as a cross-check. Bump both constants together.
export const PB_SHA256 = {
  darwin_amd64:
    "888892fe5fe64cea4a1441937671e191b32ed8f322fa09d3d7b3ca2fc1d7be29",
  darwin_arm64:
    "9da6fbe11e82c5b1704e56f7457b24682e01c510206c29b798a458119fa2be20",
  linux_amd64:
    "08b9fcda0d5fd42cb315dc15a36dfa121c993855bd635f01d347c31b4328ec34",
  linux_arm64:
    "8c785618840df7ebba795fdf4eba33a5fed64ac5307ad8023b955b4ebb82048b",
  windows_amd64:
    "b4efdc14054e1e32de998d4c216bf598c3f84fef59b3d41966c19e2600b845a9",
  windows_arm64:
    "8a02990c590843db33525328c006bc2b573cf6b97db0edf8653824400db873d7",
};

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const OS_MAP = { win32: "windows", linux: "linux", darwin: "darwin" };
const ARCH_MAP = { x64: "amd64", arm64: "arm64" };

function target() {
  const os = OS_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  if (!os || !arch) {
    throw new Error(`unsupported platform ${process.platform}/${process.arch}`);
  }
  const exe = os === "windows" ? "pocketbase.exe" : "pocketbase";
  const osArch = `${os}_${arch}`;
  const pinned = PB_SHA256[osArch];
  if (!pinned) throw new Error(`no pinned sha256 for ${osArch}`);
  return {
    exe,
    pinned,
    zipName: `pocketbase_${PB_VERSION}_${osArch}.zip`,
    binPath: join(REPO_ROOT, ".pocketbase", PB_VERSION, osArch, exe),
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Exact-name lookup in a checksums.txt body ("<hash>  <file>" per line). */
export function checksumFor(text, zipName) {
  for (const l of text.split(/\r?\n/)) {
    const [hash, name] = l.trim().split(/\s+/);
    if (name === zipName && hash) return hash.toLowerCase();
  }
  return null;
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function ensurePocketBase(log = () => {}) {
  const { exe, pinned, zipName, binPath } = target();
  // Sidecar holding the sha256 of the extracted binary, written at install time from a
  // verified zip. A cached binary is reused only if it still matches it.
  const sumPath = `${binPath}.sha256`;
  if (existsSync(binPath)) {
    const recorded = existsSync(sumPath)
      ? readFileSync(sumPath, "utf8").trim()
      : null;
    if (recorded && recorded === sha256(readFileSync(binPath))) {
      log(`PocketBase ${PB_VERSION} already present (verified): ${binPath}`);
      return binPath;
    }
    log(`Cached binary unverified or changed; re-downloading: ${binPath}`);
    rmSync(binPath, { force: true });
    rmSync(sumPath, { force: true });
  }

  const base = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}`;
  log(`Downloading ${zipName} and checksums.txt ...`);
  const [zip, sums] = await Promise.all([
    download(`${base}/${zipName}`),
    download(`${base}/checksums.txt`),
  ]);

  // Abort before extraction on any mismatch: never execute an unverified binary.
  const actual = sha256(zip);
  if (actual !== pinned) {
    throw new Error(
      `sha256 mismatch for ${zipName}: pinned ${pinned}, got ${actual}`,
    );
  }
  const listed = checksumFor(new TextDecoder().decode(sums), zipName);
  if (listed !== pinned) {
    throw new Error(
      `checksums.txt disagrees with the pinned sha256 for ${zipName}: listed ${listed ?? "none"}`,
    );
  }
  log(`sha256 verified against pinned value: ${actual}`);

  const entries = unzipSync(zip, { filter: (file) => file.name === exe });
  const bin = entries[exe];
  if (!bin) throw new Error(`${exe} not found inside ${zipName}`);

  mkdirSync(dirname(binPath), { recursive: true });
  const tmp = `${binPath}.tmp-${process.pid}`;
  writeFileSync(tmp, bin);
  if (process.platform !== "win32") chmodSync(tmp, 0o755);
  renameSync(tmp, binPath);
  writeFileSync(sumPath, `${sha256(bin)}\n`);
  log(`PocketBase ${PB_VERSION} installed: ${binPath}`);
  return binPath;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const printPath = process.argv.includes("--print-path");
  try {
    const binPath = await ensurePocketBase(
      printPath ? () => {} : (m) => console.log(m),
    );
    if (printPath) process.stdout.write(`${binPath}\n`);
  } catch (err) {
    process.stderr.write(
      `fetch-pocketbase: ${err instanceof Error ? err.message : err}\n`,
    );
    process.exit(2);
  }
}
