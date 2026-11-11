#!/usr/bin/env node
// Open human checks as JSON, for the CDS Punch List artifact. Reads .planning/HUMAN-CHECKS.md,
// drops rows whose Result says done/superseded/closed/n/a, and groups the rest by phase and
// section. Each check gets a stable id (sha1 of phase + text) so ticks survive re-publishes.
// An .html output fills scripts/human-checks-page.html (the page itself) with the data.
//   node scripts/human-checks-json.mjs [out.json]    (stdout without an argument)
//   node scripts/human-checks-json.mjs out.html      (the punch list page, ready to publish)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = readFileSync(join(root, ".planning/HUMAN-CHECKS.md"), "utf8")
  .replace(/\r/g, "")
  .split("\n");
const out = process.argv[2];

const PHASE_NAMES = {
  1: "Foundations",
  2: "Tenant core",
  3: "Core page builder",
  4: "Theming",
  5: "Add-on registry and installer",
  6: "Onboarding intake",
  7: "Blocks and media",
  8: "Templates and auto-assembly",
  9: "Agreements and e-signature",
  10: "Billing, checkout and entitlements",
  11: "Owner dashboard and editor",
  12: "Communication hub",
  13: "CDS staff console",
  14: "Domains, DNS and TLS",
  15: "CDS hub site and cutover",
};
const DONE = /\b(done|superseded|closed|n\/a)\b/i;
// Keyword buckets for the page's filters; approximate by design.
const LIVE =
  /stripe test|test keys|once (wasabi|.*keys)|wasabi|\bses\b|bunny|search console|rekognition|web risk|turnstile prod|real mail|once supplied/i;
const OPS =
  /coolify|scheduled task|migration push|ssh |cron|db:migrate|restore|deploy/i;

const split = (l) =>
  l
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

let h2 = "";
let h3 = "";
let cols = null;
let inTable = false;
const checks = [];
const seen = new Set();
for (const line of lines) {
  const m2 = line.match(/^## (.+)/);
  const m3 = line.match(/^### (.+)/);
  if (m2) [h2, h3, cols] = [m2[1], "", null];
  if (m3) [h3, cols] = [m3[1], null];
  if (m2 || m3) continue;
  if (!line.startsWith("|")) {
    inTable = false;
    continue;
  }
  const cells = split(line);
  if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
  const lower = cells.map((c) => c.toLowerCase());
  if (!inTable && lower.some((c) => /^(what to check|check)$/.test(c))) {
    cols = {
      phase: lower.indexOf("phase"),
      check: lower.findIndex((c) => /^(what to check|check)$/.test(c)),
      where: lower.findIndex((c) => c.startsWith("where")),
      result: lower.indexOf("result"),
    };
    inTable = true;
    continue;
  }
  inTable = true;
  if (!cols) continue;
  const text = cells[cols.check] || "";
  const result = cols.result >= 0 ? cells[cols.result] || "" : "";
  if (!text || DONE.test(result)) continue;
  const phaseCell = cols.phase >= 0 ? cells[cols.phase] : "";
  const pm = (phaseCell || h3 || h2).match(/P(\d+)/);
  if (!pm) continue;
  const phase = Number(pm[1]);
  let section = h3
    .replace(/^P\d+\s*·\s*/, "")
    .replace(/\s*\((?:phase \d+; )?never blocking\)/i, "");
  if (!section && phaseCell.includes(","))
    section = phaseCell.replace(/^P\d+\s*,\s*/, "");
  if (!section) section = "General";
  const where = cols.where >= 0 ? cells[cols.where] || "" : "";
  const hay = `${text} ${where}`;
  const kind = LIVE.test(hay) ? "live" : OPS.test(hay) ? "ops" : "look";
  const id = createHash("sha1")
    .update(`${phase}|${text}`)
    .digest("hex")
    .slice(0, 12);
  if (seen.has(id)) continue;
  seen.add(id);
  checks.push({ id, phase, section, text, where, note: result, kind });
}

const json = JSON.stringify({ phases: PHASE_NAMES, checks });
if (out?.endsWith(".html")) {
  // "<" escaped so check text can never close the data <script> early.
  const page = readFileSync(
    join(root, "scripts/human-checks-page.html"),
    "utf8",
  );
  writeFileSync(
    out,
    page.replace("__DATA__", () => json.replace(/</g, "\\u003c")),
  );
} else if (out) writeFileSync(out, json);
else process.stdout.write(json + "\n");
const byKind = checks.reduce(
  (a, c) => ({ ...a, [c.kind]: (a[c.kind] || 0) + 1 }),
  {},
);
console.error(`open checks: ${checks.length} ${JSON.stringify(byKind)}`);
