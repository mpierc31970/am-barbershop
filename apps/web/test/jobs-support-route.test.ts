// POST /api/jobs/support (12-31; COMM-08, COMM-09, COMM-11, SUPPORT-02; T-12-31-01, a copy of
// the alerts-route test): bearer CDS_JOB_TOKEN, 404 on any miss, fail closed when the token is unset, JSON
// counts with no-store, generic 500 when the job throws, GET reads as absent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const result = {
  dryRun: false,
  busy: false,
  closed: 1,
  slaWarned: 2,
  windowsStarted: 1,
  noticeAlerts: 3,
  windowsCleared: 1,
  rescanned: 0,
  heldPruned: 4,
  stagedPruned: 0,
  slaMissedOpen: 0,
  openWindows: [{ code: "W-12", activeHours: 1.5 }],
  failedSteps: [],
};
const runSupportJobs = vi.fn(() => Promise.resolve(result));

vi.mock("@cds/addon-registry/server", () => ({}));
vi.mock("@cds/db", () => ({
  runSupportJobs: () => runSupportJobs(),
}));

const { GET, POST, dynamic, runtime } =
  await import("../app/api/jobs/support/route");

const TOKEN = "job-token-for-tests-0123456789";

function post(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://127.0.0.1:3000/api/jobs/support", {
    method: "POST",
    headers,
  });
}

describe("POST /api/jobs/support", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_JOB_TOKEN", TOKEN);
    runSupportJobs.mockClear();
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
    expect(runSupportJobs).not.toHaveBeenCalled();
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
    expect(runSupportJobs).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_JOB_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", "");
    expect((await POST(post("Bearer "))).status).toBe(404);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(runSupportJobs).not.toHaveBeenCalled();
  });

  it("runs the job with the right bearer and returns the counts, not cached", async () => {
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(JSON.parse(await res.text())).toEqual(result);
    expect(runSupportJobs).toHaveBeenCalledTimes(1);
  });

  it("returns a generic 500 when the job throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runSupportJobs.mockImplementationOnce(() =>
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
