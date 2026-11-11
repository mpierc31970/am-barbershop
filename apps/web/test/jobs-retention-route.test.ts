// POST /api/jobs/retention (09-21; LIFE-02, D290; T-09-21-01, a copy of the media-route
// test): bearer CDS_JOB_TOKEN, 404 on any miss, fail closed when the token is unset, JSON
// result with no-store, generic 500 when the job throws, GET reads as absent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const result = {
  dryRun: false,
  orgsDue: 1,
  orgsDeleted: 1,
  capHit: false,
  deletedOrgs: [
    {
      id: "abcdefghijklmno",
      name: "Secret Spa",
      reason: "cancelled",
      closedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  signaturesExpired: 0,
  acksExpired: 0,
  auditDeleted: 3,
  orphanExportsPruned: 0,
  usersDeleted: 1,
  keptAgreementsForDeletedOrgs: 2,
  failedSteps: [],
};
const runRetentionJob = vi.fn(() => Promise.resolve(result));

vi.mock("@cds/addon-registry/server", () => ({}));
vi.mock("@cds/db", () => ({
  runRetentionJob: () => runRetentionJob(),
}));

const { GET, POST, dynamic, runtime } =
  await import("../app/api/jobs/retention/route");

const TOKEN = "job-token-for-tests-0123456789";

function post(auth?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://127.0.0.1:3000/api/jobs/retention", {
    method: "POST",
    headers,
  });
}

describe("POST /api/jobs/retention", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_JOB_TOKEN", TOKEN);
    runRetentionJob.mockClear();
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
    expect(runRetentionJob).not.toHaveBeenCalled();
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
    expect(runRetentionJob).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_JOB_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", "");
    expect((await POST(post("Bearer "))).status).toBe(404);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(runRetentionJob).not.toHaveBeenCalled();
  });

  it("runs the job with the right bearer and returns the result, not cached", async () => {
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    // Counts only: deleted org ids and names never reach the scheduled task's log.
    const counts = Object.fromEntries(
      Object.entries(result).filter(([k]) => k !== "deletedOrgs"),
    );
    const body = await res.text();
    expect(JSON.parse(body)).toEqual(counts);
    expect(body).not.toContain("Secret Spa");
    expect(body).not.toContain("abcdefghijklmno");
    expect(runRetentionJob).toHaveBeenCalledTimes(1);
  });

  it("returns a generic 500 when the job throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runRetentionJob.mockImplementationOnce(() =>
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
