// Required clauses (CONTEXT A1-Q4, A4-Q1; AGR-09, AGR-10, LIFE-02; D249, D283, D296, D297).
import { describe, expect, it } from "vitest";
import { AUP_CATEGORIES } from "../onboarding/aup";
import { clauseMarkers } from "./markdown";
import {
  activePolicyVersions,
  assertRequiredClauses,
  POLICY_KEYS,
  REQUIRED_CLAUSES,
} from "./policies";
import { POLICY_SET } from "./policies.generated";
import { retentionTableMarkdown } from "./retention";
import type { PolicyKey, PolicySet, PolicyVersion } from "./types";

function active(key: PolicyKey): PolicyVersion {
  const p = activePolicyVersions().find((v) => v.key === key);
  if (!p) throw new Error(`no active ${key}`);
  return p;
}

describe("required clauses", () => {
  it.each(POLICY_KEYS.map((k) => [k]))(
    "%s carries every required clause marker",
    (key) => {
      const markers = clauseMarkers(active(key).bodyMd);
      for (const id of REQUIRED_CLAUSES[key]) expect(markers).toContain(id);
    },
  );

  it("the committed set passes assertRequiredClauses", () => {
    expect(() => assertRequiredClauses(POLICY_SET)).not.toThrow();
  });

  it("a future ToS version that drops dmca-agent fails", () => {
    const tos = active("terms-of-service");
    const v2: PolicyVersion = {
      ...tos,
      version: 2,
      changes: "Dropped a clause.",
      bodyMd: tos.bodyMd.replace("<!-- clause:dmca-agent -->\n", ""),
    };
    const set: PolicySet = {
      policies: [...POLICY_SET.policies, v2],
      consents: POLICY_SET.consents,
    };
    expect(() => assertRequiredClauses(set)).toThrow(
      "terms-of-service:dmca-agent",
    );
  });
});

describe("texts drawn from code, never copied", () => {
  it("the DPA carries the retention table verbatim", () => {
    const dpa = active("dpa");
    expect(dpa.bodyMd).toContain(retentionTableMarkdown());
    for (const s of ["30 days", "90 days", "7 years", "never deleted"]) {
      expect(dpa.bodyHtml).toContain(s);
    }
  });

  it("the Acceptable Use policy names every AUP category", () => {
    const aup = active("acceptable-use");
    for (const c of AUP_CATEGORIES) expect(aup.bodyMd).toContain(c.name);
  });

  it("ToS states the DMCA restore window and the Report link", () => {
    const html = active("terms-of-service").bodyHtml;
    expect(html).toContain("10");
    expect(html).toContain("14 business days");
    expect(html).toContain("Report");
  });

  it("the Service Agreement names the tenant merchant of record", () => {
    expect(active("service-agreement").bodyHtml).toContain(
      "merchant of record",
    );
  });
});
