// 09-15 Task 1: pure re-acceptance gate helpers (AGR-07, CONTEXT A3-Q1, D-UI-P9-9;
// RESEARCH Pitfalls 13, 14; T-09-15-01, T-09-15-03). @cds/db is mocked: only the pure
// helpers run here; the requireHubSession gate is tested in session.test.ts.
import { describe, expect, it, vi } from "vitest";

vi.mock("@cds/db", () => ({ agreementStatus: vi.fn() }));

const {
  AGREEMENT_GATE_OPT_OUT,
  PATH_HEADER,
  isGateExempt,
  reacceptTarget,
  safeNext,
} = await import("../lib/agreement-gate");

describe("safeNext (D-UI-P9-9, Pitfall 13)", () => {
  it("keeps same-origin /hub paths", () => {
    expect(safeNext("/hub/website")).toBe("/hub/website");
    expect(safeNext("/hub")).toBe("/hub");
    expect(safeNext("/hub/checkout?x=1")).toBe("/hub/checkout?x=1");
    expect(safeNext("/hub?tab=a")).toBe("/hub?tab=a");
  });

  it("refuses everything else and returns the fallback", () => {
    for (const bad of [
      "//evil.test",
      "https://evil.test/hub",
      "/hubevil",
      "/hub\\..\\x",
      "/hub/%0d%0a",
      "/hub/%5C%5Cevil",
      "/hub//evil.test",
      "/hub/\u0000x",
      "/hub/../sign-in",
      "/hub/%2e%2e/x",
      "/hub/%E0%A4%A",
      "javascript:alert(1)",
      "/sign-in",
      "",
      `/hub/${"a".repeat(2050)}`,
      null,
      undefined,
    ]) {
      expect(safeNext(bad), String(bad).slice(0, 40)).toBe("/hub");
    }
  });

  it("uses the given fallback", () => {
    expect(safeNext("//evil.test", "/hub/settings")).toBe("/hub/settings");
  });
});

describe("AGREEMENT_GATE_OPT_OUT / isGateExempt (Pitfall 14)", () => {
  it("is one list of patterns", () => {
    expect(AGREEMENT_GATE_OPT_OUT.length).toBeGreaterThanOrEqual(3);
    for (const re of AGREEMENT_GATE_OPT_OUT) expect(re).toBeInstanceOf(RegExp);
  });

  it("exempts the agreement pages and the download route", () => {
    for (const p of [
      "/hub/agreement",
      "/hub/agreement?mode=reaccept",
      "/hub/agreement?mode=reaccept&next=%2Fhub",
      "/hub/agreement/",
      "/hub/agreement/signed/abc",
      "/hub/agreement/download/abc",
      "/hub/agreement/download/abc?x=1",
    ]) {
      expect(isGateExempt(p), p).toBe(true);
    }
  });

  it("gates every other hub path", () => {
    for (const p of [
      "/hub",
      "/hub/settings",
      "/hub/agreementx",
      "/hub/agreement/other",
      "/hub/agreement/signed/abc/x",
      "/hub/website?next=/hub/agreement",
    ]) {
      expect(isGateExempt(p), p).toBe(false);
    }
  });
});

describe("reacceptTarget", () => {
  it("sends the owner to re-accept with an encoded safe next", () => {
    expect(reacceptTarget("/hub/website?tab=pages")).toBe(
      "/hub/agreement?mode=reaccept&next=%2Fhub%2Fwebsite%3Ftab%3Dpages",
    );
  });

  it("falls back to /hub for an unsafe path", () => {
    expect(reacceptTarget("//evil.test")).toBe(
      "/hub/agreement?mode=reaccept&next=%2Fhub",
    );
  });
});

describe("PATH_HEADER", () => {
  it("is x-cds-path", () => {
    expect(PATH_HEADER).toBe("x-cds-path");
  });
});
