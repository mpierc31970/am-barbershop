// POST /api/jobs/quotes (ONB-08, PD-8; T-06-42): bearer CDS_JOB_TOKEN, 404 on any miss,
// fail closed when the token is unset, JSON result with no-store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const result = {
  reminded1: 1,
  reminded2: 0,
  skippedActive: 0,
  suppressed: 0,
  sendFailures: 0,
  expired: 2,
  purgedDrafts: 0,
  purgedLeads: 0,
  purgedUsers: 1,
  reconciled: 0,
};
const runQuoteJobs = vi.fn(() => Promise.resolve(result));

vi.mock("@cds/db", () => ({ runQuoteJobs: () => runQuoteJobs() }));

const { GET, POST, dynamic, runtime } =
  await import("../app/api/jobs/quotes/route");

const TOKEN = "job-token-for-tests-0123456789";

function post(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://127.0.0.1:3000/api/jobs/quotes", {
    method: "POST",
    headers,
  });
}

describe("POST /api/jobs/quotes", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_JOB_TOKEN", TOKEN);
    runQuoteJobs.mockClear();
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
    expect(runQuoteJobs).not.toHaveBeenCalled();
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
    expect(runQuoteJobs).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_JOB_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", "");
    expect((await POST(post("Bearer "))).status).toBe(404);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(runQuoteJobs).not.toHaveBeenCalled();
  });

  it("runs the job with the right bearer and returns the counts, not cached", async () => {
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual(result);
    expect(runQuoteJobs).toHaveBeenCalledTimes(1);
  });

  it("returns a generic 500 when the job throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runQuoteJobs.mockImplementationOnce(() =>
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
