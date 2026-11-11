// 13-30 Task 1: submitReportAction (STAFF-24, D249, P13-P24; T-13-30-01, T-13-30-02).
// next/headers and @cds/db are mocked; the per-IP limiter is the real one from
// @cds/db (importOriginal), so "5 pass, the 6th is
// RATE-REPORT" is the production bucket, not a stand-in.
import { InvalidInput } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ ip: "203.0.113.9" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": req.ip }),
  cookies: async () => ({ get: () => undefined }),
}));

const db = vi.hoisted(() => ({
  createPublicReport: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@cds/db", async (importOriginal) => {
  const rl = await importOriginal<typeof import("@cds/db")>();
  return {
    beginReportAction: rl.beginReportAction,
    resetReportLimitsForTests: rl.resetReportLimitsForTests,
    createPublicReport: db.createPublicReport,
    getHumanCheck: () => ({ verify: db.verify }),
    ERR_HUMAN:
      "We couldn't confirm you're a person. Try again, or refresh the page.",
  };
});

const { submitReportAction } = await import("../app/actions/report");
const { INITIAL_REPORT_STATE, REPORT_COPY } =
  await import("../lib/report-form");
const { resetReportLimitsForTests } = await import("@cds/db");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const SCAM = {
  category: "scam",
  site: "bella.example.com",
  url: "  https://bella.example.com/offer  ",
  description: "  This page asks for card numbers for a fake prize draw.  ",
  name: "",
  email: "  Reporter@Example.com ",
  "cf-turnstile-response": "tok",
};

const COPYRIGHT = {
  ...SCAM,
  category: "copyright",
  name: "Ana Reyes",
  originalWork: "https://ana.example.org/photo-1",
  goodFaith: "on",
  accuracy: "on",
  signature: "Ana Reyes",
};

beforeEach(() => {
  resetReportLimitsForTests();
  req.ip = "203.0.113.9";
  db.createPublicReport.mockReset();
  db.createPublicReport.mockResolvedValue({
    ref: "R-32",
    orgId: "org000000000001",
    ownerNotified: 1,
    reporterNotified: true,
  });
  db.verify.mockReset();
  db.verify.mockResolvedValue(true);
});

describe("submitReportAction", () => {
  it("a valid report calls createPublicReport once with trimmed fields and returns the case ref", async () => {
    const res = await submitReportAction(INITIAL_REPORT_STATE, form(SCAM));
    expect(res).toEqual({
      status: "sent",
      ref: "R-32",
      email: "reporter@example.com",
    });
    expect(db.createPublicReport).toHaveBeenCalledTimes(1);
    expect(db.createPublicReport).toHaveBeenCalledWith({
      targetUrl: "https://bella.example.com/offer",
      category: "scam",
      description: "This page asks for card numbers for a fake prize draw.",
      reporterName: null,
      reporterEmail: "reporter@example.com",
      dmcaStatement: null,
    });
    expect(db.verify).toHaveBeenCalledWith("tok", "203.0.113.9");
  });

  it("copyright sends the DMCA statement and folds the original work into the description", async () => {
    const res = await submitReportAction(INITIAL_REPORT_STATE, form(COPYRIGHT));
    expect(res.status).toBe("sent");
    const arg = db.createPublicReport.mock.calls[0]![0];
    expect(arg.category).toBe("copyright");
    expect(arg.reporterName).toBe("Ana Reyes");
    expect(arg.dmcaStatement).toEqual({
      goodFaith: true,
      accuracy: true,
      signature: "Ana Reyes",
    });
    expect(arg.description).toContain(
      "Original work: https://ana.example.org/photo-1",
    );
  });

  it("copyright without a signature or ticks is a field error and nothing is created", async () => {
    const res = await submitReportAction(
      INITIAL_REPORT_STATE,
      form({ ...COPYRIGHT, signature: "  ", goodFaith: "", accuracy: "" }),
    );
    expect(res.status).toBe("idle");
    if (res.status !== "idle") return;
    expect(res.fieldErrors.signature).toBe(REPORT_COPY.ERR_SIGNATURE);
    expect(res.fieldErrors.goodFaith).toBe(REPORT_COPY.ERR_GOODFAITH);
    expect(res.fieldErrors.accuracy).toBe(REPORT_COPY.ERR_ACCURATE);
    expect(db.createPublicReport).not.toHaveBeenCalled();
    expect(db.verify).not.toHaveBeenCalled();
  });

  it("refuses javascript: and other non-http URLs as a field error", async () => {
    for (const url of [
      "javascript:x",
      "data:text/html,hi",
      "ftp://a.example/",
    ]) {
      const res = await submitReportAction(
        INITIAL_REPORT_STATE,
        form({ ...SCAM, url }),
      );
      expect(res.status).toBe("idle");
      if (res.status === "idle")
        expect(res.fieldErrors.url).toBe(REPORT_COPY.ERR_URL);
    }
    expect(db.createPublicReport).not.toHaveBeenCalled();
  });

  it("checks caps: short description, bad email, missing category, oversized URL", async () => {
    const res = await submitReportAction(
      INITIAL_REPORT_STATE,
      form({
        ...SCAM,
        category: "spam",
        description: "too short",
        email: "nope",
        url: `https://a.example/${"x".repeat(2000)}`,
      }),
    );
    expect(res.status).toBe("idle");
    if (res.status !== "idle") return;
    expect(res.fieldErrors).toMatchObject({
      category: REPORT_COPY.ERR_CATEGORY,
      description: REPORT_COPY.ERR_DESCRIPTION_SHORT,
      email: REPORT_COPY.ERR_EMAIL,
      url: REPORT_COPY.ERR_URL,
    });
  });

  it("a failed Turnstile check returns ERR-HUMAN and never calls createPublicReport", async () => {
    db.verify.mockResolvedValue(false);
    const res = await submitReportAction(INITIAL_REPORT_STATE, form(SCAM));
    expect(res).toEqual({
      status: "idle",
      error:
        "We couldn't confirm you're a person. Try again, or refresh the page.",
      fieldErrors: {},
    });
    expect(db.createPublicReport).not.toHaveBeenCalled();
  });

  it("5 reports from one IP pass, the 6th is RATE-REPORT; another IP is unaffected", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await submitReportAction(INITIAL_REPORT_STATE, form(SCAM));
      expect(res.status).toBe("sent");
    }
    const sixth = await submitReportAction(INITIAL_REPORT_STATE, form(SCAM));
    expect(sixth).toEqual({
      status: "idle",
      error: P13_COPY.RATE_REPORT,
      fieldErrors: {},
    });
    expect(db.createPublicReport).toHaveBeenCalledTimes(5);
    req.ip = "198.51.100.7";
    const other = await submitReportAction(INITIAL_REPORT_STATE, form(SCAM));
    expect(other.status).toBe("sent");
  });

  it("an InvalidInput from the chokepoint is shown; other errors log the class name only", async () => {
    db.createPublicReport.mockRejectedValueOnce(
      new InvalidInput("Enter the full page address, starting with https://"),
    );
    const a = await submitReportAction(INITIAL_REPORT_STATE, form(SCAM));
    expect(a.status === "idle" && a.error).toBe(
      "Enter the full page address, starting with https://",
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      db.createPublicReport.mockRejectedValueOnce(
        new TypeError("reporter@example.com bella.example.com"),
      );
      const b = await submitReportAction(INITIAL_REPORT_STATE, form(SCAM));
      expect(b.status === "idle" && b.error).toBe(REPORT_COPY.ERR_SEND);
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).toContain("TypeError");
      expect(logged).not.toContain("example.com");
    } finally {
      spy.mockRestore();
    }
  });
});
