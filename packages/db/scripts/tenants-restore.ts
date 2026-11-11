// On-demand tenant restore (TEN-10, TEN-12). Restores ONE organization from an export bundle
// in object storage, after a CDS staff MFA sign-in as super_admin (tenant_restore). The
// restore is one all-or-nothing PocketBase batch and is audited as "tenant.restore".
//
// Usage:
//   npm run tenants:restore -- --org <org-id> --key <object-key> [--restore-status]
//   npm run tenants:restore -- --help
// The org keeps its current status (active / held / disabled) unless --restore-status.
// Then enter, when asked: staff email, password (not echoed on a terminal), emailed code.
// Stdin may also be piped (one value per line).
//
// Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required; .env.local is read by
// the npm script), CDS_ENV, CDS_STORAGE_DIR, WASABI_* (as for tenants:export).
// Output is a STORE line, then PASS / FAIL lines only; credentials and codes are never printed.
// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import { Writable } from "node:stream";
import { createInterface } from "node:readline";
import { completeStaffSignIn, signInStaff } from "../src/auth";
import { restoreTenant } from "../src/export";
import {
  describeObjectStore,
  getObjectStore,
  tenantExportPrefix,
} from "../src/storage";

const USAGE = `tenants:restore - restore one organization from an export (super_admin, MFA)

  npm run tenants:restore -- --org <org-id> --key <object-key> [--restore-status]
  npm run tenants:restore -- --help

--restore-status  also restore the org status from the export (default: keep current)
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required)
     CDS_ENV (unset: dev/ prefix), CDS_STORAGE_DIR, WASABI_* (optional)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];
const CLI_IP = "cli";

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  // Close the readline + stdin pipe first: process.exit() with a pipe read still active
  // can abort on Windows (exit 0xC0000409 instead of 1), the tenants-cli flake in
  // deferred-items 03-03 / 03-07 / 03-16.
  try {
    rl.close();
    process.stdin.destroy();
  } catch {
    // exiting anyway
  }
  process.exit(1);
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

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq?.slice(name.length + 1);
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const org = argValue(args, "--org");
  const key = argValue(args, "--key");
  if (!org) fail("--org <org-id> is required");
  if (!key) fail("--key <object-key> is required");
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }
  let prefix: string;
  try {
    prefix = tenantExportPrefix(org);
  } catch {
    fail("--org is not a valid organization id");
  }
  if (!key.startsWith(prefix)) {
    fail(`--key must be an export of this organization (${prefix}...)`);
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

  console.log(`STORE ${describeObjectStore()}`);
  const bytes = await getObjectStore().get(key);
  if (!bytes) fail("no export at that key");
  let bundle: unknown;
  try {
    bundle = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("the export is not valid JSON");
  }
  const bundleOrg =
    bundle && typeof bundle === "object"
      ? (bundle as { orgId?: unknown }).orgId
      : undefined;
  if (bundleOrg !== org) fail("the export belongs to another organization");

  const res = await restoreTenant(ctx, bundle, {
    restoreStatus: args.includes("--restore-status"),
  });
  const counts = Object.entries(res.restored)
    .map(([c, n]) => `${c}=${n}`)
    .join(" ");
  for (const s of res.skipped) {
    console.log(`SKIP ${s.collection} ${s.id || "*"}: ${s.reason}`);
  }
  console.log(`PASS restored ${org} (${counts})`);
}

main()
  .then(() => {
    rl.close();
    process.exit(0);
  })
  .catch((err: unknown) => fail(describeError(err)));
