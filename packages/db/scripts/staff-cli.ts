// Shared plumbing for the staff CLIs (06-10: leads:list, fit:review, prices:set). Copied from
// the P5 addons:install pattern (addons-install.ts is left unchanged): strict argument
// parsing, a muted password prompt, the staff email + password + emailed code sign-in
// (MFA, T-06-47) and an exit that never calls process.exit() while stdin is being read.
// Credentials and codes are never printed.
import { Writable } from "node:stream";
import { createInterface, type Interface } from "node:readline";
import { completeStaffSignIn, signInStaff } from "../src/auth";
import type { PlatformContext } from "../src/context";

export const REQUIRED_ENV = [
  "PB_URL",
  "PB_SUPERUSER_EMAIL",
  "PB_SUPERUSER_PASSWORD",
];
export const CLI_IP = "cli";
export const REASON_MAX = 500;
export const ORG_RE = /^[a-z0-9]{15}$/;

/**
 * Thrown for every refusal; runMain() prints it as "FAIL <message>" and exits 1. `plain`
 * prints the message as is (a UI-SPEC sentence rather than a FAIL line).
 */
export class CliFail extends Error {
  readonly plain: boolean;
  constructor(message: string, opts: { plain?: boolean } = {}) {
    super(message);
    this.plain = opts.plain === true;
  }
}

export function fail(message: string): never {
  throw new CliFail(message);
}

export type ParsedArgs = Map<string, string | true>;

/** Parses --name value / --name=value pairs and flags; anything else is refused (T-06-51). */
export function parseArgs(
  argv: readonly string[],
  spec: { known: readonly string[]; withValue: readonly string[] },
): ParsedArgs {
  const known = new Set([...spec.known, "--help", "-h"]);
  const withValue = new Set(spec.withValue);
  const out: ParsedArgs = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (!known.has(name)) fail(`unknown argument ${name.slice(0, 40)}`);
    if (withValue.has(name)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
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

export function wantsHelp(args: ParsedArgs): boolean {
  return args.has("--help") || args.has("-h");
}

/** A 1-500 character --reason, trimmed. */
export function reasonArg(args: ParsedArgs): string {
  const raw = args.get("--reason");
  if (typeof raw !== "string") fail('--reason "<text>" is required');
  const reason = raw.trim();
  if (reason === "" || reason.length > REASON_MAX) {
    fail(`--reason must be 1-${REASON_MAX} characters`);
  }
  return reason;
}

// Prompts: output goes through a stream we can mute while the password is typed. Created
// lazily so --help and --dry-run never touch stdin.
let muted = false;
let rl: Interface | null = null;
let lines: AsyncIterableIterator<string> | null = null;

function prompts(): AsyncIterableIterator<string> {
  if (!lines) {
    const output = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    rl = createInterface({
      input: process.stdin,
      output,
      terminal: Boolean(process.stdin.isTTY),
    });
    lines = rl[Symbol.asyncIterator]();
  }
  return lines;
}

export async function ask(prompt: string, hidden = false): Promise<string> {
  const it = prompts();
  process.stdout.write(prompt);
  muted = hidden && Boolean(process.stdin.isTTY);
  const next = await it.next();
  if (muted) process.stdout.write("\n");
  muted = false;
  if (next.done) fail("input ended before all values were entered");
  return String(next.value).trim();
}

/**
 * Ends the process without process.exit() while a stdin pipe read may still be active:
 * that can abort on Windows (deferred-items 03-03 / 03-07). Close readline and stdin, set
 * the exit code and let the event loop drain; an unref'd timer is the safety net.
 */
export function finish(code: number): void {
  try {
    rl?.close();
    process.stdin.destroy();
  } catch {
    // exiting anyway
  }
  process.exitCode = code;
  setTimeout(() => process.exit(code), 5000).unref();
}

export function describeError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && err instanceof Error) {
    const code = String((err as { code: unknown }).code);
    return err.message ? `${code}: ${err.message}` : code;
  }
  if (err instanceof Error) {
    return err.name === "ClientResponseError" ? "database error" : err.message;
  }
  return "unknown error";
}

export function requireEnv(): void {
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`${name} is not set`);
  }
}

/** Staff email, password (muted on a terminal) and the emailed code (MFA). */
export async function signInStaffInteractive(
  ip: string = CLI_IP,
): Promise<PlatformContext> {
  requireEnv();
  const email = await ask("Staff email: ");
  const secret = await ask("Password: ", true);
  const started = await signInStaff(email, secret, ip);
  console.log("Sign-in OTP sent to the staff email. Enter it below.");
  const otp = await ask("Code: ");
  const { ctx } = await completeStaffSignIn({
    mfaId: started.mfaId,
    otpId: started.otpId,
    code: otp,
    ip,
  });
  console.log("PASS signed in");
  return ctx;
}

/** Runs main, prints a refusal as a FAIL line (or a plain UI-SPEC sentence) and exits. */
export function runMain(main: () => Promise<void>): void {
  main()
    .then(() => finish(0))
    .catch((err: unknown) => {
      if (err instanceof CliFail && err.plain) console.error(err.message);
      else {
        console.error(
          `FAIL ${err instanceof CliFail ? err.message : describeError(err)}`,
        );
      }
      finish(1);
    });
}

/**
 * Tenant- or visitor-written text made safe to print (A-WR-10): every C0/C1 control
 * character (ESC starts ANSI/OSC sequences that could rewrite or hide terminal output) is
 * shown as "?", so what staff read is what is stored.
 */
export function safeText(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
}

/** Left-aligned columns, two spaces apart. Cells are printed through safeText. */
export function table(header: readonly string[], rows: string[][]): string {
  rows = rows.map((r) => r.map(safeText));
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}
