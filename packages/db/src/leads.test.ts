// WR-A03 (08 review, slice A): the ASSEMBLED word never shows more tries than the cap.
import { describe, expect, it } from "vitest";
import { assembledWord } from "./leads";

describe("assembledWord", () => {
  it("clamps a failed ledger's attempts to the cap", () => {
    const base = { template_id: "t", template_version: 1, pages: {} };
    expect(assembledWord({ ...base, status: "failed", attempts: 2 })).toBe(
      "failed 2/3",
    );
    expect(assembledWord({ ...base, status: "failed", attempts: 4 })).toBe(
      "failed 3/3",
    );
  });
});
