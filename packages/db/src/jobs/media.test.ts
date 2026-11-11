// runMediaJobs with every step faked (07-27 choice 6): order, result shape, step isolation,
// heartbeat, mutex.
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { describe, expect, it, vi } from "vitest";
import type { MediaJobDeps } from "./media";
import { runMediaJobs } from "./media";

const NOW = new Date("2026-10-06T10:00:00.000Z");

function fakes(log: string[], over: Partial<MediaJobDeps> = {}) {
  const meta = new Map<string, string>();
  const deps: MediaJobDeps = {
    probeCdn: async () => {
      log.push("probe");
      return { result: "down", canary: true };
    },
    applyProbe: async () => {
      log.push("fallback");
      return {
        downSince: NOW,
        started: true,
        capped: false,
        recovered: false,
        alertsSkipped: 1,
        alertFailures: 0,
      };
    },
    sweepStuckVideos: async () => {
      log.push("videos");
      return { requeued: 2, failed: 1 };
    },
    sweepTempDirs: async () => {
      log.push("temp");
      return { removed: 3, skipped: 0, errors: 0 };
    },
    alertOverAllowance: async () => {
      log.push("allowance");
      return { alerted: 1, skipped: 0, failed: 1 };
    },
    writeMeta: async (_c, k, v) => {
      meta.set(k, v);
    },
    gc: {
      sections: composeSectionRegistry(CORE_SECTIONS, []),
      invalidator: { invalidate: () => undefined },
    },
    runGc: async () => {
      log.push("gc");
      return {
        gcPages: 5,
        gcPopups: 1,
        gcForms: 2,
        gcMedia: 3,
        gcKept: 4,
        gcErrors: 0,
      };
    },
    ...over,
  };
  return { deps, meta };
}

describe("runMediaJobs (07-27)", () => {
  it("runs the steps in order and returns the counts", async () => {
    const log: string[] = [];
    const { deps, meta } = fakes(log);
    const r = await runMediaJobs({ now: NOW, deps });
    expect(log).toEqual([
      "probe",
      "fallback",
      "videos",
      "temp",
      "allowance",
      "gc",
    ]);
    expect(r).toEqual({
      probe: "down",
      fallbackActive: true,
      fallbackStarted: true,
      fallbackCapped: false,
      recovered: false,
      videosRequeued: 2,
      videosFailed: 1,
      tempRemoved: 3,
      overAllowanceAlerted: 1,
      alertsSkipped: 1,
      alertFailures: 1,
      gcPages: 5,
      gcPopups: 1,
      gcForms: 2,
      gcMedia: 3,
      gcKept: 4,
      gcErrors: 0,
      failedSteps: [],
    });
    expect(meta.get("job:media:last_success")).toBe(NOW.toISOString());
    expect(JSON.parse(meta.get("job:media:last_counts")!)).toEqual(r);
  });

  it("a throwing step is listed, later steps still run, no last_success", async () => {
    const log: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, meta } = fakes(log, {
      sweepStuckVideos: async () => {
        log.push("videos");
        throw new Error("pb down");
      },
    });
    const r = await runMediaJobs({ now: NOW, deps });
    spy.mockRestore();
    expect(log).toEqual([
      "probe",
      "fallback",
      "videos",
      "temp",
      "allowance",
      "gc",
    ]);
    expect(r.failedSteps).toEqual(["videos"]);
    expect(meta.has("job:media:last_success")).toBe(false);
    expect(meta.has("job:media:last_counts")).toBe(true);
  });

  it("a throwing gc lands in failedSteps after the other steps; their counts stay", async () => {
    const log: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, meta } = fakes(log, {
      runGc: async () => {
        log.push("gc");
        throw new Error("pb down");
      },
    });
    const r = await runMediaJobs({ now: NOW, deps });
    spy.mockRestore();
    expect(log).toEqual([
      "probe",
      "fallback",
      "videos",
      "temp",
      "allowance",
      "gc",
    ]);
    expect(r.failedSteps).toEqual(["gc"]);
    expect(r.videosRequeued).toBe(2);
    expect(r.tempRemoved).toBe(3);
    expect(r.gcPopups).toBe(0);
    expect(meta.has("job:media:last_success")).toBe(false);
    expect(JSON.parse(meta.get("job:media:last_counts")!)).toMatchObject({
      gcPopups: 0,
      gcErrors: 0,
      failedSteps: ["gc"],
    });
  });

  it("without the section registry the gc step fails loudly, never skips", async () => {
    const log: string[] = [];
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((m: unknown) => void errors.push(String(m)));
    const { deps } = fakes(log, { gc: undefined });
    const r = await runMediaJobs({ now: NOW, deps });
    spy.mockRestore();
    expect(r.failedSteps).toEqual(["gc"]);
    expect(log).not.toContain("gc");
    expect(errors.join(" ")).toContain(
      "gc needs the composed section registry",
    );
  });

  it("a throwing probe skips the fallback step", async () => {
    const log: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = fakes(log, {
      probeCdn: async () => {
        throw new Error("x");
      },
    });
    const r = await runMediaJobs({ now: NOW, deps });
    spy.mockRestore();
    expect(r.probe).toBe("error");
    expect(r.failedSteps).toEqual(["probe"]);
    expect(log).toEqual(["videos", "temp", "allowance", "gc"]);
  });

  it("two concurrent runs never interleave", async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const { deps } = fakes(log, {
      probeCdn: async () => {
        log.push("probe");
        if (first) {
          first = false;
          await gate;
        }
        return { result: "ok", canary: true };
      },
    });
    const a = runMediaJobs({ now: NOW, deps });
    const b = runMediaJobs({ now: NOW, deps });
    await new Promise((r) => setTimeout(r, 10));
    expect(log).toEqual(["probe"]);
    release();
    await Promise.all([a, b]);
    expect(log).toEqual([
      "probe",
      "fallback",
      "videos",
      "temp",
      "allowance",
      "gc",
      "probe",
      "fallback",
      "videos",
      "temp",
      "allowance",
      "gc",
    ]);
  });
});
