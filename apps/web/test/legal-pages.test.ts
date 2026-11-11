// 09-09: public policy page resolver (AGR-01, AGR-07; CONTEXT A3-Q4, D215, D216). Every
// /legal URL resolves to one compiled version or to not-found.
import {
  activePolicyVersions,
  POLICY_SET,
  type PolicySet,
  type PolicyVersion,
} from "@cds/core/legal";
import { describe, expect, it } from "vitest";
import { LEGAL_LINKS } from "../lib/legal-links";
import {
  formatLegalDate,
  parseVersionSegment,
  resolveLegalPage,
} from "../lib/legal-pages";

function tos(version: number, effectiveAt: string): PolicyVersion {
  const base = POLICY_SET.policies.find((p) => p.key === "terms-of-service")!;
  return { ...base, version, effectiveAt };
}

const FIXTURE: PolicySet = {
  policies: [
    tos(1, "2026-10-01"),
    tos(2, "2027-01-01"),
    ...POLICY_SET.policies.filter(
      (p) => p.key !== "terms-of-service" && p.version === 1,
    ),
  ],
  consents: POLICY_SET.consents,
};

describe("parseVersionSegment", () => {
  it("accepts v<N> with no leading zero, up to 4 digits", () => {
    expect(parseVersionSegment("v1")).toBe(1);
    expect(parseVersionSegment("v12")).toBe(12);
    expect(parseVersionSegment("v9999")).toBe(9999);
  });

  it.each(["v0", "1", "v01", "v1.5", "v99999", "", "V1", "v", "v1 ", "v-1"])(
    "rejects %j",
    (seg) => {
      expect(parseVersionSegment(seg)).toBeNull();
    },
  );
});

describe("resolveLegalPage", () => {
  it("resolves the active version of a known key", () => {
    const r = resolveLegalPage("terms-of-service");
    expect(r).not.toBeNull();
    expect(r!.isCurrent).toBe(true);
    expect(r!.policy).toBe(r!.current);
    expect(r!.replacedOn).toBeNull();
    expect(r!.policy.key).toBe("terms-of-service");
  });

  it("returns null for an unknown key or version", () => {
    expect(resolveLegalPage("nope")).toBeNull();
    expect(resolveLegalPage("dpa", 9)).toBeNull();
    expect(resolveLegalPage("__proto__")).toBeNull();
  });

  it("resolves a past version with its replaced-on date", () => {
    const r = resolveLegalPage("terms-of-service", 1, FIXTURE);
    expect(r).not.toBeNull();
    expect(r!.isCurrent).toBe(false);
    expect(r!.policy.version).toBe(1);
    expect(r!.current.version).toBe(2);
    expect(r!.replacedOn).toBe("2027-01-01");
    expect(r!.earlier).toEqual([{ version: 1, until: "2027-01-01" }]);
  });

  it("treats an explicit current version as current", () => {
    const r = resolveLegalPage("terms-of-service", 2, FIXTURE);
    expect(r!.isCurrent).toBe(true);
    expect(r!.replacedOn).toBeNull();
    expect(r!.earlier).toEqual([{ version: 1, until: "2027-01-01" }]);
  });

  it("has no earlier versions for a single-version policy", () => {
    expect(resolveLegalPage("dpa", undefined, FIXTURE)!.earlier).toEqual([]);
  });
});

describe("LEGAL_LINKS (client copy of the five policies)", () => {
  it("matches the active policy set in D216 order", () => {
    expect(LEGAL_LINKS).toEqual(
      activePolicyVersions().map((p) => ({
        href: `/legal/${p.key}`,
        title: p.title,
      })),
    );
  });
});

describe("formatLegalDate", () => {
  it("formats an ISO day by hand", () => {
    expect(formatLegalDate("2026-10-01")).toBe("1 Oct 2026");
    expect(formatLegalDate("2027-01-31")).toBe("31 Jan 2027");
    expect(formatLegalDate("2026-12-09")).toBe("9 Dec 2026");
  });

  it("returns the input unchanged when it is not an ISO day", () => {
    expect(formatLegalDate("soon")).toBe("soon");
  });
});
