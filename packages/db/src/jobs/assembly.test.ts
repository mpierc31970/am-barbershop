// runAssemblyJobs with fakes (08-17 choices 3-4): selection, counts shape, per-org isolation,
// heartbeat only on a clean run. Plus enqueueAssembly: fire-and-forget, serial, never rejects.
import type { AssemblyLedger } from "@cds/core/templates";
import { emptyLedger } from "../assembly/ledger";
import { describe, expect, it, vi } from "vitest";
import type { AssemblyResult } from "../assembly/assemble";
import type { AssemblyRunDeps } from "../assembly/run";
import {
  ASSEMBLY_COUNTS_KEY,
  ASSEMBLY_HEARTBEAT_KEY,
  runAssemblyJobs,
  type AssemblyCandidate,
} from "./assembly";

const NOW = new Date("2026-10-07T10:00:00.000Z");
const DEPS = {} as AssemblyRunDeps;

const id = (n: number) => `org${String(n).padStart(12, "0")}`;

function ledger(over: Partial<AssemblyLedger> = {}): AssemblyLedger {
  return { ...emptyLedger(), ...over };
}

function res(
  status: AssemblyResult["status"],
  l: AssemblyLedger = ledger(),
): AssemblyResult {
  return {
    status,
    ledger: l,
    report: null,
    previewHost: null,
    dryRun: false,
    facts: null,
  };
}

function metaSink() {
  const meta = new Map<string, string>();
  return {
    meta,
    writeMeta: async (_c: unknown, k: string, v: string) => {
      meta.set(k, v);
    },
  };
}

describe("runAssemblyJobs (08-17)", () => {
  it("selects by ledger, isolates a failing org, writes the heartbeat and counts", async () => {
    const candidates: AssemblyCandidate[] = [
      { orgId: id(1), ledger: ledger() }, // queued: run -> done
      { orgId: id(2), ledger: ledger({ status: "done", attempts: 1 }) }, // skip
      { orgId: id(3), ledger: ledger({ status: "failed", attempts: 3 }) }, // skip
      { orgId: id(4), ledger: ledger({ status: "failed", attempts: 1 }) }, // run -> throws
      {
        orgId: id(5),
        ledger: ledger({
          status: "running",
          attempts: 1,
          started_at: new Date(NOW.getTime() - 31 * 60_000).toISOString(),
        }),
      }, // recover -> done
      {
        orgId: id(6),
        ledger: ledger({
          status: "running",
          attempts: 1,
          started_at: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
        }),
      }, // still running: skip
      { orgId: id(7), ledger: ledger({ status: "failed", attempts: 2 }) }, // run -> 3rd fail
      { orgId: id(8), ledger: ledger() }, // run -> no_template
    ];
    const ran: string[] = [];
    const runOrg = vi.fn(async (orgId: string) => {
      ran.push(orgId);
      if (orgId === id(4)) throw new Error("boom");
      if (orgId === id(7)) {
        return res(
          "failed",
          ledger({ status: "failed", attempts: 3, failure_emailed: true }),
        );
      }
      if (orgId === id(8)) return res("no_template");
      return res("done", ledger({ status: "done", attempts: 1 }));
    });
    const sink = metaSink();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await runAssemblyJobs({
      now: NOW,
      deps: DEPS,
      writeMeta: sink.writeMeta,
      listCandidates: async () => candidates,
      runOrg,
    });
    err.mockRestore();
    expect(ran).toEqual([id(1), id(4), id(5), id(7), id(8)]);
    expect(r).toEqual({
      assembled: 2,
      failed: 2,
      skipped: 4,
      stuckRecovered: 1,
      failureEmails: 1,
      failedSteps: [],
    });
    expect(Object.keys(r).sort()).toEqual(
      [
        "assembled",
        "failed",
        "skipped",
        "stuckRecovered",
        "failureEmails",
        "failedSteps",
      ].sort(),
    );
    expect(sink.meta.get(ASSEMBLY_HEARTBEAT_KEY)).toBe(NOW.toISOString());
    const counts = JSON.parse(sink.meta.get(ASSEMBLY_COUNTS_KEY) ?? "{}");
    expect(counts).toEqual(r);
    // No org id or message leaks into the counts.
    expect(sink.meta.get(ASSEMBLY_COUNTS_KEY)).not.toContain("org0");
    expect(sink.meta.get(ASSEMBLY_COUNTS_KEY)).not.toContain("boom");
  });

  it("a failed list step skips the heartbeat but still writes counts", async () => {
    const sink = metaSink();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await runAssemblyJobs({
      now: NOW,
      deps: DEPS,
      writeMeta: sink.writeMeta,
      listCandidates: async () => {
        throw new Error("pb down");
      },
      runOrg: async () => res("done"),
    });
    expect(err.mock.calls.flat().join(" ")).not.toContain("pb down");
    err.mockRestore();
    expect(r.failedSteps).toEqual(["list"]);
    expect(sink.meta.has(ASSEMBLY_HEARTBEAT_KEY)).toBe(false);
    expect(sink.meta.has(ASSEMBLY_COUNTS_KEY)).toBe(true);
  });
});

describe("enqueueAssembly (08-17)", () => {
  it("returns at once, runs serially, logs a code and never rejects", async () => {
    vi.resetModules();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.doMock("../assembly/run", async (orig) => ({
      ...(await orig<typeof import("../assembly/run")>()),
      runAssemblyForOrg: vi.fn(async (orgId: string) => {
        order.push(`start:${orgId}`);
        if (orgId === id(1)) await gate;
        if (orgId === id(2)) {
          throw Object.assign(new Error("secret detail"), {
            code: "FINISH_FAILED",
          });
        }
        order.push(`end:${orgId}`);
        return res("done");
      }),
    }));
    const { enqueueAssembly, assemblyQueue } =
      await import("../assembly/queue");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(enqueueAssembly(id(1), DEPS)).toBeUndefined();
    enqueueAssembly(id(2), DEPS);
    enqueueAssembly("not-an-id", DEPS);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([`start:${id(1)}`]);
    release();
    while (assemblyQueue.pending > 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([`start:${id(1)}`, `end:${id(1)}`, `start:${id(2)}`]);
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("[assembly] FINISH_FAILED");
    expect(logged).toContain("[assembly] INVALID_ORG_ID");
    expect(logged).not.toContain("secret detail");
    err.mockRestore();
    vi.doUnmock("../assembly/run");
  });
});
