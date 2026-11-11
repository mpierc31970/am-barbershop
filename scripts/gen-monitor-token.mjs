#!/usr/bin/env node
// Dev MONITOR_TOKEN generator (13-40; STAFF-16, D175; T-13-40-03, T-13-40-05). Appends
// `MONITOR_TOKEN=<32 random bytes, base64url>` to the repo-root .env.local when the key is
// absent. Never prints the value. Production: set MONITOR_TOKEN on the app in Coolify (GO-LIVE).
//   node scripts/gen-monitor-token.mjs
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, ".env.local");
const current = existsSync(file) ? readFileSync(file, "utf8") : "";

if (/^MONITOR_TOKEN=/m.test(current)) {
  console.log("MONITOR_TOKEN already in .env.local (left unchanged)");
} else {
  const token = randomBytes(32).toString("base64url");
  const lead = current === "" || current.endsWith("\n") ? "" : "\n";
  appendFileSync(file, `${lead}MONITOR_TOKEN=${token}\n`, { mode: 0o600 });
  console.log("MONITOR_TOKEN written to .env.local");
}
