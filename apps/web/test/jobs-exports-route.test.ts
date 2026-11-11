// POST /api/jobs/exports (milestone audit; TEN-12, a copy of the retention-route test):
// bearer CDS_JOB_TOKEN, 404 on any miss, fail closed when the token is unset, counts-only
// JSON with no-store, 500 on a failed org or a throw, GET reads as absent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const result = {
  exported: [
    { orgId: "abcdefghijklmno", key: "tenants/abcdefghijklmno/exports/x.json" },
  ],
  pruned: ["tenants/abcdefghijklmno/exports/old.json"],
  failed: [] as { orgId: string; error: string }[],
};
const runNightlyExports = vi.fn(() => Promise.resolve(result));

vi.mock("@cds/addon-registry/server", () => ({}));
vi.mock("@cds/db", () => ({
  runNightlyExports: () => runNightlyExports(),
}));

const { GET, POST, dynamic, runtime } =
  await import("../app/api/jobs/exports/route");

const TOKEN = "job-token-for-tests-0123456789";

function post(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://127.0.0.1:3000/api/jobs/exports", {
    method: "POST",
    headers,
  });
}

describe("POST /api/jobs/exports", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_JOB_TOKEN", TOKEN);
    runNightlyExports.mockClear();
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
    expect(runNightlyExports).not.toHaveBeenCalled();
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
    expect(runNightlyExports).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_JOB_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", "");
    expect((await POST(post("Bearer "))).status).toBe(404);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(runNightlyExports).not.toHaveBeenCalled();
  });

  it("runs the job and returns counts only, not cached", async () => {
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ exported: 1, pruned: 1, failed: 0 });
    expect(body).not.toContain("abcdefghijklmno");
    expect(runNightlyExports).toHaveBeenCalledTimes(1);
  });

  it("returns 500 with counts when an org failed", async () => {
    runNightlyExports.mockImplementationOnce(() =>
      Promise.resolve({
        ...result,
        failed: [{ orgId: "abcdefghijklmno", error: "boom" }],
      }),
    );
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ exported: 1, pruned: 1, failed: 1 });
    expect(body).not.toContain("boom");
  });

  it("returns a generic 500 when the job throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runNightlyExports.mockImplementationOnce(() =>
      Promise.reject(new Error("pb down at secret-host")),
    );
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("secret-host");
    expect(JSON.parse(body)).toEqual({ error: "job failed" });
    spy.mockRestore();
  });

  it("GET reads as absent", () => {
    expect(GET().status).toBe(404);
  });
});
