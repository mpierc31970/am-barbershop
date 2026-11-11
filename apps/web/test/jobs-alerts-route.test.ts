// POST /api/jobs/alerts (11-23; DASH-35, DASH-36; T-11-23-01, a copy of the retention-route
// test): bearer CDS_JOB_TOKEN, 404 on any miss, fail closed when the token is unset, JSON
// counts with no-store, generic 500 when the job throws, GET reads as absent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const result = {
  dryRun: false,
  busy: false,
  pushSent: 4,
  collapsed: 2,
  released: 7,
  heldQuiet: 3,
  heldCollapse: 0,
  retried: 0,
  pushFailed: 0,
  digestsSent: 6,
  digestsSkippedEmpty: 9,
  digestFailures: 0,
  pruned: 0,
  failedSteps: [],
};
const runAlertJobs = vi.fn(() => Promise.resolve(result));

vi.mock("@cds/addon-registry/server", () => ({}));
vi.mock("@cds/db", () => ({
  runAlertJobs: () => runAlertJobs(),
}));

const { GET, POST, dynamic, runtime } =
  await import("../app/api/jobs/alerts/route");

const TOKEN = "job-token-for-tests-0123456789";

function post(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://127.0.0.1:3000/api/jobs/alerts", {
    method: "POST",
    headers,
  });
}

describe("POST /api/jobs/alerts", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_JOB_TOKEN", TOKEN);
    runAlertJobs.mockClear();
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
    expect(runAlertJobs).not.toHaveBeenCalled();
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
    expect(runAlertJobs).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_JOB_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", "");
    expect((await POST(post("Bearer "))).status).toBe(404);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(runAlertJobs).not.toHaveBeenCalled();
  });

  it("runs the job with the right bearer and returns the counts, not cached", async () => {
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(JSON.parse(await res.text())).toEqual(result);
    expect(runAlertJobs).toHaveBeenCalledTimes(1);
  });

  it("returns a generic 500 when the job throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runAlertJobs.mockImplementationOnce(() =>
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
