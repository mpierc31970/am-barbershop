// Staff add-on install / removal for ONE organization (ADDON-09 staff path, D21; CONTEXT
// A2-Q4). Adds or removes any add-on, private ones included, after a CDS staff MFA sign-in
// as super_admin (addon_install, checked inside installAddonAsStaff). Audited with the
// reason given. Removal disables and retains (invariant 9): nothing is deleted.
//
// Usage:
//   npm run addons:install -- --org <org-id> --addon <slug> --reason "<text>" [--uninstall] [--dry-run]
//   npm run addons:install -- --help
// --dry-run checks the add-on exists (private ones too) and prints what would happen,
// without signing in. Otherwise enter, when asked: staff email, password (not echoed on a
// terminal), emailed code. Stdin may also be piped (one value per line).
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script), CDS_ENV, CDS_STORAGE_DIR, WASABI_* (the seeded page publishes to the store).
// Output is PASS / FAIL / DRY RUN lines only; credentials and codes are never printed.
// Registers add-on collections and manifests before anything reads the registry (05-04).
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { Writable } from "node:stream";
import { createInterface } from "node:readline";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { standInBillingGate } from "../src/addons/billing";
import {
  installAddonAsStaff,
  uninstallAddonAsStaff,
} from "../src/addons/installer";
import type { AddonDeps } from "../src/addons/types";
import { completeStaffSignIn, signInStaff } from "../src/auth";
import { recordingInvalidator } from "../src/content/ports";
import {
  getContentScanner,
  getSearchPinger,
} from "../src/content/scan-standin";

const USAGE = `addons:install - add or remove an add-on for one organization (super_admin, MFA)

  npm run addons:install -- --org <org-id> --addon <slug> --reason "<text>" [--uninstall] [--dry-run]
  npm run addons:install -- --help

--addon      any add-on slug, private ones included
--reason     why (1-500 characters), written to the audit log
--uninstall  remove from the site instead (records are kept; adding it back restores them)
--dry-run    check the arguments and print what would happen, without signing in
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_ENV (unset: dev/ prefix), CDS_STORAGE_DIR, WASABI_* (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];
const KNOWN = new Set([
  "--org",
  "--addon",
  "--reason",
  "--uninstall",
  "--dry-run",
  "--help",
  "-h",
]);
const WITH_VALUE = new Set(["--org", "--addon", "--reason"]);
const ORG_RE = /^[a-z0-9]{15}$/;
const REASON_MAX = 500;
const CLI_IP = "cli";

/** Thrown for every refusal; main() prints it as a FAIL line and exits 1. */
class CliFail extends Error {}

function fail(message: string): never {
  throw new CliFail(message);
}

/**
 * Ends the process without process.exit() while a stdin pipe read may still be active:
 * that can abort on Windows (exit 0xC0000409 instead of 1, deferred-items 03-03 / 03-07).
 * Close readline and stdin, set the exit code and let the event loop drain; an unref'd
 * timer is the safety net if a socket keeps it alive.
 */
function finish(code: number): void {
  try {
    rl.close();
    process.stdin.destroy();
  } catch {
    // exiting anyway
  }
  process.exitCode = code;
  setTimeout(() => process.exit(code), 5000).unref();
}

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && err instanceof Error) {
    const code = String((err as { code: unknown }).code);
    return err.message ? `${code}: ${err.message}` : code;
  }
  if (err instanceof Error) {
    return err.name === "ClientResponseError" ? "database error" : err.message;
  }
  return "unknown error";
}

/** Parses --name value / --name=value pairs and flags; anything else is refused. */
function parseArgs(args: string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (!KNOWN.has(name)) fail(`unknown argument ${name.slice(0, 40)}`);
    if (WITH_VALUE.has(name)) {
      const value = eq > 0 ? arg.slice(eq + 1) : args[++i];
      if (value === undefined || value.startsWith("--")) {
        fail(`${name} needs a value`);
      }
      out.set(name, value);
    } else {
      if (eq > 0) fail(`${name} takes no value`);
      out.set(name, true);
    }
  }
  return out;
}

// Prompts: output goes through a stream we can mute while the password is typed.
let muted = false;
const output = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});
const rl = createInterface({
  input: process.stdin,
  output,
  terminal: Boolean(process.stdin.isTTY),
});
const lines = rl[Symbol.asyncIterator]();

async function ask(prompt: string, hidden = false): Promise<string> {
  process.stdout.write(prompt);
  muted = hidden && Boolean(process.stdin.isTTY);
  const next = await lines.next();
  if (muted) process.stdout.write("\n");
  muted = false;
  if (next.done) fail("input ended before all values were entered");
  return String(next.value).trim();
}

function deps(): AddonDeps {
  return {
    sections: composeSectionRegistry(CORE_SECTIONS, ADDON_REGISTRY.sections()),
    // No Next cache to invalidate from a CLI; the site's 60 s cache catches up.
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    addons: ADDON_REGISTRY,
    billing: standInBillingGate(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    console.log(USAGE);
    return;
  }
  const org = args.get("--org");
  const slug = args.get("--addon");
  const reasonRaw = args.get("--reason");
  if (typeof org !== "string") fail("--org <org-id> is required");
  if (typeof slug !== "string") fail("--addon <slug> is required");
  if (typeof reasonRaw !== "string") fail('--reason "<text>" is required');
  if (!ORG_RE.test(org)) fail("--org is not a valid organization id");
  const reason = reasonRaw.trim();
  if (reason === "" || reason.length > REASON_MAX) {
    fail(`--reason must be 1-${REASON_MAX} characters`);
  }
  const manifest = ADDON_REGISTRY.get(slug);
  if (!manifest) fail(`unknown add-on ${slug.slice(0, 64)}`);
  const uninstall = args.has("--uninstall");
  const verb = uninstall ? "remove" : "add";

  if (args.has("--dry-run")) {
    console.log(
      `DRY RUN would ${verb} ${manifest.slug} for org ${org} (${manifest.visibility})`,
    );
    return;
  }
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }

  const email = await ask("Staff email: ");
  const secret = await ask("Password: ", true);
  const started = await signInStaff(email, secret, CLI_IP);
  console.log("Sign-in OTP sent to the staff email. Enter it below.");
  const otp = await ask("Code: ");
  const { ctx } = await completeStaffSignIn({
    mfaId: started.mfaId,
    otpId: started.otpId,
    code: otp,
    ip: CLI_IP,
  });
  console.log("PASS signed in");

  const input = { orgId: org, slug: manifest.slug, reason };
  if (uninstall) {
    const res = await uninstallAddonAsStaff(ctx, deps(), input);
    console.log(`PASS removed ${res.slug} for org ${org} (${res.outcome})`);
  } else {
    const res = await installAddonAsStaff(ctx, deps(), input);
    console.log(`PASS added ${res.slug} for org ${org} (${res.outcome})`);
  }
}

main()
  .then(() => finish(0))
  .catch((err: unknown) => {
    console.error(
      `FAIL ${err instanceof CliFail ? err.message : describeError(err)}`,
    );
    finish(1);
  });
