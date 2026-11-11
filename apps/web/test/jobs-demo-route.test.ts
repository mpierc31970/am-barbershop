// POST /api/jobs/demo (13-31; STAFF-18; T-13-31-04, a copy of the review-route
// test): bearer CDS_JOB_TOKEN, 404 on any miss, fail closed when the token is unset, JSON counts
// with no-store, generic 500 when the job throws, GET reads as absent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const result = {
  dryRun: false,
  busy: false,
  reset: 1,
  skippedHour: 0,
  rowsDeleted: 120,
  rowsSeeded: 118,
  failedSteps: [],
};
const runDemoResetJob = vi.fn((opts?: unknown) => {
  void opts;
  return Promise.resolve(result);
});
const invalidator = { invalidate: vi.fn() };

const ADDON_REGISTRY = { list: () => [] };
const SECTION_REGISTRY = { get: () => undefined };
vi.mock("@cds/addon-registry/server", () => ({ ADDON_REGISTRY }));
vi.mock("../lib/section-registry", () => ({ SECTION_REGISTRY }));
vi.mock("@cds/db", () => ({
  runDemoResetJob: (opts: unknown) => runDemoResetJob(opts),
}));
vi.mock("../lib/invalidator", () => ({ nextInvalidator: invalidator }));

const { GET, POST, dynamic, runtime } =
  await import("../app/api/jobs/demo/route");

const TOKEN = "job-token-for-tests-0123456789";

function post(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://127.0.0.1:3000/api/jobs/demo", {
    method: "POST",
    headers,
  });
}

describe("POST /api/jobs/demo", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_JOB_TOKEN", TOKEN);
    runDemoResetJob.mockClear();
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
    expect(runDemoResetJob).not.toHaveBeenCalled();
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
    expect(runDemoResetJob).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_JOB_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", "");
    expect((await POST(post("Bearer "))).status).toBe(404);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(runDemoResetJob).not.toHaveBeenCalled();
  });

  it("runs the job with the right bearer, both registries and the Next invalidator, returns counts, not cached", async () => {
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(JSON.parse(await res.text())).toEqual(result);
    expect(runDemoResetJob).toHaveBeenCalledTimes(1);
    expect(runDemoResetJob.mock.calls[0]![0]).toEqual({
      addons: ADDON_REGISTRY,
      sections: SECTION_REGISTRY,
      invalidator,
    });
  });

  it("returns a generic 500 when the job throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runDemoResetJob.mockImplementationOnce(() =>
      Promise.reject(new Error("pb down at secret-host")),
    );
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("secret-host");
    expect(JSON.parse(body)).toEqual({ error: "job failed" });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("secret-host");
    spy.mockRestore();
  });

  it("GET reads as absent", () => {
    expect(GET().status).toBe(404);
  });
});
