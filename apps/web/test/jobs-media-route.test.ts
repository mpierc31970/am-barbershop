// POST /api/jobs/media (07-27; T-07-27-01, a copy of the quotes-route test): bearer CDS_JOB_TOKEN, 404 on any miss,
// fail closed when the token is unset, JSON result with no-store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const result = {
  probe: "skipped",
  fallbackActive: false,
  fallbackStarted: false,
  fallbackCapped: false,
  recovered: false,
  videosRequeued: 0,
  videosFailed: 0,
  tempRemoved: 2,
  overAllowanceAlerted: 1,
  alertsSkipped: 0,
  alertFailures: 0,
  gcPages: 0,
  gcPopups: 1,
  gcForms: 0,
  gcMedia: 0,
  gcKept: 2,
  gcErrors: 0,
  failedSteps: [],
};
const runMediaJobs = vi.fn((opts?: unknown) => Promise.resolve(opts && result));
const REGISTRY = { get: () => undefined, list: () => [] };
const INVALIDATOR = { invalidate: () => undefined };

vi.mock("@cds/db", () => ({
  runMediaJobs: (opts?: unknown) => runMediaJobs(opts),
}));
vi.mock("../lib/section-registry", () => ({ SECTION_REGISTRY: REGISTRY }));
vi.mock("../lib/invalidator", () => ({ nextInvalidator: INVALIDATOR }));

const { GET, POST, dynamic, runtime } =
  await import("../app/api/jobs/media/route");

const TOKEN = "job-token-for-tests-0123456789";

function post(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://127.0.0.1:3000/api/jobs/media", {
    method: "POST",
    headers,
  });
}

describe("POST /api/jobs/media", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_JOB_TOKEN", TOKEN);
    runMediaJobs.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a force-dynamic nodejs route", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("404s without an Authorization header", async () => {
    const res = await POST(post());
    expect(res.status).toBe(404);
    expect(runMediaJobs).not.toHaveBeenCalled();
  });

  it("404s with a wrong bearer or a non-bearer scheme", async () => {
    for (const auth of [
      `Bearer ${TOKEN}x`,
      "Bearer nope",
      `Basic ${TOKEN}`,
      TOKEN,
      "Bearer ",
    ]) {
      expect((await POST(post(auth))).status, auth).toBe(404);
    }
    expect(runMediaJobs).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_JOB_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", "");
    expect((await POST(post("Bearer "))).status).toBe(404);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(runMediaJobs).not.toHaveBeenCalled();
  });

  it("runs the job with the right bearer and returns the counts, not cached", async () => {
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual(result);
    expect(runMediaJobs).toHaveBeenCalledTimes(1);
    // 07-28: step 6 (soft-delete GC) gets the composed registry and the invalidator.
    expect(runMediaJobs).toHaveBeenCalledWith({
      deps: { gc: { sections: REGISTRY, invalidator: INVALIDATOR } },
    });
  });

  it("returns a generic 500 when the job throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runMediaJobs.mockImplementationOnce(() =>
      Promise.reject(new Error("pb down at secret-host")),
    );
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret-host");
    spy.mockRestore();
  });

  it("GET reads as absent", () => {
    expect(GET().status).toBe(404);
  });
});
