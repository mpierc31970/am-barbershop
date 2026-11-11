#!/usr/bin/env node
// design:detect (THEME-04, D48): run the pinned impeccable engine's drift detector over
// the tenant-facing source trees and exit with its code (0 clean, 1 a target could not be
// scanned, 2 primary findings). The engine honours ./DESIGN.md (the platform --site-*
// vocabulary) and .impeccable/config.json (reasoned ignores) from the repo root.
//
// design-system-color is advisory in engine 0.1.5; the colour gate is
// tests/theme-drift.test.ts (RESEARCH Finding 1).
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureEngine } from "./fetch-engine.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGETS = [
  "packages/ui/src/site",
  "packages/templates",
  "packages/addons",
  "apps/web/app/tenant",
];

let bin;
try {
  bin = await ensureEngine();
} catch (err) {
  process.stderr.write(
    `design:detect: ${err instanceof Error ? err.message : err}\n`,
  );
  process.exit(2);
}

const res = spawnSync(bin, ["detect", ...TARGETS], {
  cwd: REPO_ROOT,
  env: { ...process.env, IMPECCABLE_SKILL_DIR: REPO_ROOT },
  timeout: 300_000,
  stdio: "inherit",
});
if (res.error) {
  process.stderr.write(`design:detect: ${res.error.message}\n`);
}
process.exit(res.status ?? 1);
