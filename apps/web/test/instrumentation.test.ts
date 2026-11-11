// 07-13 choice 10: boot resume of interrupted video jobs through Next instrumentation.
// Node runtime only, 30 s after start, skipped during `next build` and with
// CDS_VIDEO_RESUME=off; a failing resume is logged once, never thrown.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ resumeVideoJobs: vi.fn() }));
vi.mock("@cds/db", () => db);

const { register } = await import("../instrumentation");

const KEYS = ["NEXT_RUNTIME", "NEXT_PHASE", "CDS_VIDEO_RESUME"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.NEXT_RUNTIME = "nodejs";
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("instrumentation register()", () => {
  it("calls resumeVideoJobs once, 30 s after start, on the Node runtime", async () => {
    db.resumeVideoJobs.mockResolvedValue({ requeued: 2, failed: 0 });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await register();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(db.resumeVideoJobs).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(db.resumeVideoJobs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(db.resumeVideoJobs).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[video] resume: 2 requeued, 0 failed");
    info.mockRestore();
  });

  it("does nothing on the edge runtime, during next build, or when turned off", async () => {
    for (const env of [
      { NEXT_RUNTIME: "edge" },
      { NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" },
      { NEXT_RUNTIME: "nodejs", CDS_VIDEO_RESUME: "off" },
    ]) {
      delete process.env.NEXT_PHASE;
      delete process.env.CDS_VIDEO_RESUME;
      Object.assign(process.env, env);
      await register();
    }
    await vi.advanceTimersByTimeAsync(120_000);
    expect(db.resumeVideoJobs).not.toHaveBeenCalled();
  });

  it("a rejecting resume is caught and logged once", async () => {
    db.resumeVideoJobs.mockRejectedValue(new Error("pb down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(register()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(db.resumeVideoJobs).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[video] resume failed");
    error.mockRestore();
  });
});
