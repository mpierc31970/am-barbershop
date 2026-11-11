// Theme import CLI (THEME-03, THEME-05 "at import"; D45; CONTEXT A1-Q3). CDS staff import an
// impeccable-authored theme directory (DESIGN.md + .impeccable/design.json under design/)
// into one organization's `design`. The full report (roles, contrast pairs, solver
// adjustments, fonts) prints BEFORE anything is written; --dry-run stops there.
//
// Usage:
//   npm run theme:import -- --org <org-id> --dir <theme-dir> [--dry-run]
//   npm run theme:import -- --help
// A real import then asks for: staff email, password (not echoed on a terminal), emailed
// code. Stdin may also be piped (one value per line). --dry-run never signs in or writes.
//
// Env (real import only): PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (.env.local is
// read by the npm script).
// The write goes through setOrganizationDesign (staff-only, audited "theme.import", one
// batch). Invalidation is recorded, not sent: the theme cache revalidates within 60 s
// (RESEARCH Pitfall 6), hence "within a minute" in the success copy.
// Invariant 1: this script never holds a PocketBase client.
import { basename } from "node:path";
import { Writable } from "node:stream";
import { createInterface } from "node:readline";
import { Forbidden, InvalidContext, InvalidInput, NotFound } from "@cds/core";
import {
  formatReport,
  importThemeDir,
  ORG_NOT_FOUND_COPY,
  RESULT_DRY_RUN,
  RESULT_ROLES_DERIVED,
  RESULT_SUCCESS,
  WRITE_FAILED_COPY,
  type ThemeImportResult,
} from "@cds/core/theme/import";
import { completeStaffSignIn, signInStaff } from "../src/auth";
import { recordingInvalidator } from "../src/content/ports";
import { setOrganizationDesign } from "../src/theme";

const USAGE = `theme:import - import an authored theme into one organization (CDS staff, MFA)

  npm run theme:import -- --org <org-id> --dir <theme-dir> [--dry-run]
  npm run theme:import -- --help

--dir      a theme folder inside design/ holding DESIGN.md + .impeccable/design.json
--dry-run  print the report only; no sign-in, nothing written
Prompts for staff email, password and the emailed sign-in code.
Env: PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD (required for a real import)`;

const REQUIRED_ENV = ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"];
const CLI_IP = "cli";

/** Print the failure copy as the last line and exit 1. */
function fail(message: string): never {
  console.error(message);
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
  // A hidden answer, or any piped answer, is never echoed: end the prompt line ourselves
  // so the next line (and a failure copy) starts clean.
  if (muted || !process.stdin.isTTY) process.stdout.write("\n");
  muted = false;
  if (next.done) fail("Input ended before all values were entered.");
  return String(next.value).trim();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const org = argValue(args, "--org");
  const dir = argValue(args, "--dir");
  const dryRun = args.includes("--dry-run");
  if (!org || org.startsWith("--"))
    fail(`--org <org-id> is required\n\n${USAGE}`);
  if (!dir || dir.startsWith("--")) {
    fail(`--dir <theme-dir> is required\n\n${USAGE}`);
  }

  // 1. Read, map and solve. Nothing is written; any authoring problem is the last line.
  let imported: ThemeImportResult;
  try {
    imported = importThemeDir(dir, { root: process.cwd() });
  } catch (err) {
    if (err instanceof InvalidInput) fail(err.message);
    throw err;
  }
  const { design, report } = imported;

  // 2. The report, always before any prompt (solver fallbacks print as warnings in it).
  process.stdout.write(
    formatReport(report, {
      orgId: org,
      slug: basename(dir.replace(/[\\/]+$/, "")),
      dryRun,
    }),
  );
  if (report.derivedRoles) {
    console.log(RESULT_ROLES_DERIVED);
    console.log(JSON.stringify(report.derivedRoles, null, 2));
  }
  if (dryRun) {
    console.log(`Result  ${RESULT_DRY_RUN}`);
    return;
  }

  // 3. Staff MFA sign-in (T-04-29): the only way to a PlatformContext.
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set.`);
  }
  let ctx: Awaited<ReturnType<typeof completeStaffSignIn>>["ctx"];
  try {
    const email = await ask("Staff email: ");
    const secret = await ask("Password: ", true);
    const started = await signInStaff(email, secret, CLI_IP);
    console.log(
      "Sign-in code sent to the staff email (local dev: the OTP_STANDIN line in the PocketBase output). Enter it below.",
    );
    const otp = await ask("Code: ");
    ({ ctx } = await completeStaffSignIn({
      mfaId: started.mfaId,
      otpId: started.otpId,
      code: otp,
      ip: CLI_IP,
    }));
  } catch (err) {
    fail(describeError(err));
  }

  // 4. The write: staff-only, audited, one batch. Unknown org and a staff role without
  //    theme_import share one copy so the CLI never reveals which (T-04-31).
  try {
    await setOrganizationDesign(ctx, org, design, {
      invalidator: recordingInvalidator(),
    });
  } catch (err) {
    if (
      err instanceof NotFound ||
      err instanceof Forbidden ||
      err instanceof InvalidContext
    ) {
      fail(ORG_NOT_FOUND_COPY(org));
    }
    fail(WRITE_FAILED_COPY);
  }
  console.log(`Result  ${RESULT_SUCCESS}`);
}

main()
  .then(() => {
    rl.close();
    process.exit(0);
  })
  .catch((err: unknown) => fail(describeError(err)));
