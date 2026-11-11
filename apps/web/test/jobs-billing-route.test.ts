// POST /api/jobs/billing (10-21; PAY-02, D244; T-10-21-01, a copy of the retention-route
// test): bearer CDS_JOB_TOKEN, 404 on any miss, fail closed when the token is unset, JSON
// counts with no-store, generic 500 when the job throws, GET reads as absent, optional
// `{ dryRun: true }` body.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const counts = {
  dryRun: false,
  since: "2026-10-10T11:50:00.000Z",
  eventsSeen: 3,
  applied: 2,
  duplicates: 1,
  ignored: 0,
  failed: 0,
  retried: 0,
  accountsChecked: 4,
  restricted: 0,
  backlog: 0,
  failedSteps: [],
};
const result = {
  ...counts,
  planned: [{ type: "invoice.paid", ref: "in_secret_ref" }],
};
const runBillingJob = vi.fn<
  (opts?: { dryRun?: boolean }) => Promise<typeof result>
>(() => Promise.resolve(result));
const deps = vi.hoisted(() => ({ ensurePaymentAddonDeps: vi.fn() }));

vi.mock("../lib/payment-deps", () => deps);
vi.mock("@cds/db", () => ({
  runBillingJob: (opts?: { dryRun?: boolean }) => runBillingJob(opts),
  billingCounts: (r: typeof result) => {
    const c: Partial<typeof result> = { ...r };
    delete c.planned;
    return c;
  },
}));

const { GET, POST, dynamic, runtime } =
  await import("../app/api/jobs/billing/route");

const TOKEN = "job-token-for-tests-0123456789";

function post(auth?: string, body?: string): Request {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new Request("http://127.0.0.1:3000/api/jobs/billing", {
    method: "POST",
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

describe("POST /api/jobs/billing", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_JOB_TOKEN", TOKEN);
    runBillingJob.mockClear();
    deps.ensurePaymentAddonDeps.mockClear();
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
    expect(runBillingJob).not.toHaveBeenCalled();
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
    expect(runBillingJob).not.toHaveBeenCalled();
  });

  it("fails closed: 404 when CDS_JOB_TOKEN is unset, even with a bearer", async () => {
    vi.stubEnv("CDS_JOB_TOKEN", "");
    expect((await POST(post("Bearer "))).status).toBe(404);
    expect((await POST(post(`Bearer ${TOKEN}`))).status).toBe(404);
    expect(runBillingJob).not.toHaveBeenCalled();
  });

  it("runs the job with the add-on deps registered; counts only, not cached", async () => {
    const res = await POST(post(`Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.text();
    expect(JSON.parse(body)).toEqual(counts);
    expect(body).not.toContain("in_secret_ref");
    expect(runBillingJob).toHaveBeenCalledWith({ dryRun: false });
    expect(deps.ensurePaymentAddonDeps).toHaveBeenCalledTimes(1);
  });

  it("passes { dryRun: true } and ignores any other body", async () => {
    await POST(post(`Bearer ${TOKEN}`, JSON.stringify({ dryRun: true })));
    expect(runBillingJob).toHaveBeenLastCalledWith({ dryRun: true });
    for (const body of [
      JSON.stringify({ dryRun: "yes", since: "2020-01-01" }),
      "not json",
      "[]",
      "null",
    ]) {
      await POST(post(`Bearer ${TOKEN}`, body));
      expect(runBillingJob, body).toHaveBeenLastCalledWith({ dryRun: false });
    }
  });

  it("returns a generic 500 when the job throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runBillingJob.mockImplementationOnce(() =>
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
