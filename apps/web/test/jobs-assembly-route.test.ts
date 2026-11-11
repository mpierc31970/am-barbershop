// POST /api/jobs/assembly (08-17; T-08-17-01, a copy of the media-route test): bearer
// CDS_JOB_TOKEN, 404 on any miss, fail closed when the token is unset, JSON counts with
// no-store, a generic 500 on a thrown sweep.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const result = {
  assembled: 2,
  failed: 0,
  skipped: 1,
  stuckRecovered: 0,
  failureEmails: 0,
  failedSteps: [],
};
const runAssemblyJobs = vi.fn((opts?: unknown) =>
  Promise.resolve(opts && result),
);
const DEPS = { deps: "assembly" };

vi.mock("@cds/db", () => ({
  runAssemblyJobs: (opts?: unknown) => runAssemblyJobs(opts),
}));
vi.mock("../lib/assembly-deps", () => ({ assemblyDeps: () => DEPS }));

const { GET, POST, dynamic, runtime } =
  await import("../app/api/jobs/assembly/route");

const TOKEN = "job-token-for-tests-0123456789";

function post(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://127.0.0.1:3000/api/jobs/assembly", {
    method: "POST",
    headers,
  });
}

describe("POST /api/jobs/assembly", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_JOB_TOKEN", TOKEN);
    runAssemblyJobs.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a force-dynamic nodejs route", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("404s without an Authorization header", async () => {
    expect((await POST(post())).status).toBe(404);
    expect(runAssemblyJobs).not.toHaveBeenCalled();
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
    expect(runAssemblyJobs).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_JOB_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", "");
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    vi.stubEnv("CDS_JOB_TOKEN", undefined as unknown as string);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    vi.stubEnv("CDS_JOB_TOKEN", "  \n");
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(runAssemblyJobs).not.toHaveBeenCalled();
  });

  it("IN-C01: a token set with surrounding whitespace still matches the bare bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", `${TOKEN}\n`);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(200);
    vi.stubEnv("CDS_JOB_TOKEN", ` ${TOKEN} `);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(200);
    expect(runAssemblyJobs).toHaveBeenCalledTimes(2);
  });

  it("runs the sweep with the app's assembly deps and returns the counts, not cached", async () => {
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual(result);
    expect(runAssemblyJobs).toHaveBeenCalledTimes(1);
    expect(runAssemblyJobs).toHaveBeenCalledWith({ deps: DEPS });
  });

  it("returns a generic 500 when the sweep throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runAssemblyJobs.mockImplementationOnce(() =>
      Promise.reject(new Error("pb down at secret-host")),
    );
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "job failed" });
    expect(body).not.toContain("secret-host");
    spy.mockRestore();
  });

  it("GET reads as absent", () => {
    expect(GET().status).toBe(404);
  });
});
