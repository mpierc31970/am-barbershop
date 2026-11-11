// 10-24: the billing:reconcile CLI (PAY-02; UI-SPEC "Staff CLI output"). `--help` and a bad
// `--since` run as a child process with the root npm script's flags; the report runs
// in-process against a throwaway PocketBase with a stub provider and stub handlers, so the
// output lines, the dry run (nothing recorded) and the failed-step exit are checked.
import type {
  CdsBilling,
  NormalisedEvent,
  PaymentGateway,
} from "@cds/core/payments";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main, USAGE } from "../scripts/billing-reconcile";
import { CliFail } from "../scripts/staff-cli";
import type { AddonDeps } from "../src/addons/types";
import type { BillingJobDeps } from "../src/jobs/billing";
import type { HandlerMap } from "../src/payments/handlers/types";
import { bootSeededPb, type SeededPb } from "./seeded";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_DIR, "..", "..");
const SCRIPT = join(PKG_DIR, "scripts", "billing-reconcile.ts");
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  pathToFileURL(join(PKG_DIR, "scripts", "register-ts.mjs")).href,
];

function runChild(args: string[]) {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("billing:reconcile arguments (child process)", () => {
  it("--help prints usage and exits 0", () => {
    const r = runChild(["--help"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain(
      "billing:reconcile - re-read CDS billing and Connect accounts and apply missed events",
    );
  });

  it("a bad --since exits 1 with a clear message", () => {
    const r = runChild(["--since", "yesterday"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("--since must be hours (24h), days (2d)");
  });

  it("an unknown argument exits 1", () => {
    const r = runChild(["--force"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("unknown argument --force");
  });
});

// ------------------------------------------------------------------ in-process report
let booted: SeededPb | null = null;
const NOW = new Date("2026-10-08T05:00:00.000Z");

beforeAll(async () => {
  booted = await bootSeededPb();
});
afterAll(async () => {
  await booted?.inst.stop();
});

function event(
  type: "subscription.updated" | "invoice.paid" | "checkout.completed",
  id: string,
): NormalisedEvent {
  const base = {
    id,
    provider: "fake" as const,
    account: null,
    orgId: null,
    createdAt: NOW.toISOString(),
  };
  if (type === "subscription.updated") {
    return { ...base, type, subscriptionId: `sub_${id}` };
  }
  if (type === "invoice.paid") return { ...base, type, invoiceId: `in_${id}` };
  return { ...base, type, sessionId: `cs_${id}` };
}

function depsFor(events: NormalisedEvent[] | Error): BillingJobDeps {
  const billing = {
    provider: "fake",
    reconcile: () =>
      events instanceof Error
        ? Promise.reject(events)
        : Promise.resolve(events),
  } as unknown as CdsBilling;
  const gateway = {
    provider: "fake",
    reconcile: () => Promise.resolve([]),
  } as unknown as PaymentGateway;
  const applied = () => Promise.resolve("applied" as const);
  const handlers: HandlerMap = {
    "subscription.updated": applied,
    "invoice.paid": applied,
    "checkout.completed": applied,
  };
  return {
    billing,
    gateway,
    handlers,
    addons: {} as AddonDeps,
  };
}

async function capture(fn: () => Promise<void>): Promise<{
  out: string;
  err: unknown;
}> {
  const lines: string[] = [];
  const spy = vi
    .spyOn(console, "log")
    .mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  let err: unknown = null;
  try {
    await fn();
  } catch (e) {
    err = e;
  } finally {
    spy.mockRestore();
    quiet.mockRestore();
  }
  return { out: lines.join("\n"), err };
}

describe("billing:reconcile report (throwaway PocketBase)", () => {
  it("prints usage in-process with the exact first line", async () => {
    const { out } = await capture(() => main(["--help"]));
    expect(out).toBe(USAGE);
  });

  it("dry run: says so first, uses 'would record' and records nothing", async (ctx) => {
    if (!booted) return ctx.skip();
    const t = randomBytes(4).toString("hex");
    const events = [
      event("subscription.updated", `evt_s_${t}`),
      event("invoice.paid", `evt_i_${t}`),
      event("checkout.completed", `evt_c_${t}`),
    ];
    const dry = await capture(() =>
      main(["--since", "1h", "--dry-run"], {
        deps: depsFor(events),
        now: NOW,
      }),
    );
    expect(dry.err).toBeNull();
    const lines = dry.out.split("\n");
    expect(lines[0]).toBe("Dry run: nothing was changed.");
    expect(lines[1]).toBe(
      "Billing reconcile · 2026-10-08 05:00 UTC · since 2026-10-08 04:00 UTC",
    );
    expect(dry.out).toMatch(/Subscriptions read:\s+1 {3}would record: 1/);
    expect(dry.out).toMatch(/Invoices read:\s+1 {3}would record: 1/);
    expect(dry.out).toMatch(/Checkout sessions:\s+1 {3}would record: 1/);
    expect(dry.out).toContain("Would record:");
    expect(dry.out).toContain(`in_evt_i_${t}`);

    // Nothing was recorded: the live run applies all three, none is a duplicate.
    const live = await capture(() =>
      main(["--since", "1h"], { deps: depsFor(events), now: NOW }),
    );
    expect(live.err).toBeNull();
    const ll = live.out.split("\n");
    expect(ll[0]).toBe(
      "Billing reconcile · 2026-10-08 05:00 UTC · since 2026-10-08 04:00 UTC",
    );
    expect(live.out).toMatch(/Subscriptions read:\s+1 {3}changed: 1/);
    expect(live.out).toMatch(/Invoices read:\s+1 {3}new: 1/);
    expect(live.out).toMatch(
      /Checkout sessions:\s+1 {3}completed but missed: 1/,
    );
    expect(live.out).toMatch(/Stripe accounts:\s+\d+ {3}restricted: \d+/);
    expect(live.out).toMatch(/Events already handled:\s+0\s+\(skipped\)/);
    expect(live.out).not.toContain("would record");

    // A rerun finds them already handled.
    const again = await capture(() =>
      main(["--since", "2026-10-08T04:00:00Z"], {
        deps: depsFor(events),
        now: NOW,
      }),
    );
    expect(again.out).toMatch(/Subscriptions read:\s+1 {3}changed: 0/);
    expect(again.out).toMatch(/Events already handled:\s+3\s+\(skipped\)/);
  });

  it("columns line up", async (ctx) => {
    if (!booted) return ctx.skip();
    const { out } = await capture(() =>
      main(["--since", "24h"], { deps: depsFor([]), now: NOW }),
    );
    const counted = out
      .split("\n")
      .slice(1)
      .filter((l) => /^\S.*:\s+\d+/.test(l));
    expect(counted.length).toBeGreaterThanOrEqual(5);
    const col = (l: string) => /\d+/.exec(l.slice(20))!.index + 20;
    const cols = new Set(
      counted.map((l) => col(l) + /\d+/.exec(l.slice(col(l)))![0].length),
    );
    expect(cols.size).toBe(1);
  });

  it("a failed step prints the report and exits 1", async (ctx) => {
    if (!booted) return ctx.skip();
    const r = await capture(() =>
      main(["--since", "1h"], {
        deps: depsFor(new Error("provider down")),
        now: NOW,
      }),
    );
    expect(r.err).toBeInstanceOf(CliFail);
    expect(r.out).toContain("Steps that failed: cds-objects");
    expect(r.out).toContain("Billing reconcile ·");
  });

  it("a bad or future --since is refused before any work", async () => {
    for (const v of ["soon", "2099-01-01"]) {
      const r = await capture(() =>
        main(["--since", v], { deps: depsFor([]), now: NOW }),
      );
      expect(r.err, v).toBeInstanceOf(CliFail);
      expect(r.out).toBe("");
    }
  });
});
