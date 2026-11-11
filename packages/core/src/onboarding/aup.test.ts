// ONB-12, D215, T-06-03: AUP_CATEGORIES must match both tables of
// .planning/design/ACCEPTABLE-USE.md exactly. The test reads the file; aup.ts never does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUP_CATEGORIES, AUP_TEST_TERMS } from "./index";
import type { AupVerdict } from "./index";

const DOC = join(
  import.meta.dirname,
  "../../../../.planning/design/ACCEPTABLE-USE.md",
);

/** Rows (first two cells) of the first markdown table after `heading`. */
function tableAfter(md: string, heading: string): [string, string][] {
  const start = md.indexOf(heading);
  expect(start, `${heading} missing from ACCEPTABLE-USE.md`).toBeGreaterThan(
    -1,
  );
  const rest = md.slice(start + heading.length);
  const next = rest.search(/\n## /);
  const section = next === -1 ? rest : rest.slice(0, next);
  const rows = section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  // rows[0] is the header, rows[1] the |---| divider.
  return rows.slice(2).map((l) => {
    const cells = l
      .slice(1, l.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    return [cells[0] ?? "", cells[1] ?? ""];
  });
}

const md = readFileSync(DOC, "utf8");
const expected: { name: string; examples: string; verdict: AupVerdict }[] = [
  ...tableAfter(md, "## Never hosted").map(([name, examples]) => ({
    name,
    examples,
    verdict: "never" as const,
  })),
  ...tableAfter(md, "## Allowed but reviewed first").map(
    ([name, examples]) => ({ name, examples, verdict: "review" as const }),
  ),
];

describe("AUP_CATEGORIES drift test (ACCEPTABLE-USE.md)", () => {
  it("parses both tables", () => {
    expect(
      expected.filter((e) => e.verdict === "never").length,
    ).toBeGreaterThan(5);
    expect(
      expected.filter((e) => e.verdict === "review").length,
    ).toBeGreaterThan(2);
  });

  it("has exactly the same categories, examples and verdicts, in order", () => {
    expect(
      AUP_CATEGORIES.map(({ name, examples, verdict }) => ({
        name,
        examples,
        verdict,
      })),
    ).toEqual(expected);
  });

  it("every category has lower-case keywords", () => {
    for (const c of AUP_CATEGORIES) {
      expect(c.keywords.length, c.name).toBeGreaterThan(0);
      for (const k of c.keywords) {
        expect(k, c.name).toBe(k.toLowerCase());
        expect(k.trim(), c.name).toBe(k);
      }
    }
  });

  it("carries the synthetic test terms in the first category of each verdict", () => {
    const firstNever = AUP_CATEGORIES.find((c) => c.verdict === "never");
    const firstReview = AUP_CATEGORIES.find((c) => c.verdict === "review");
    expect(firstNever?.keywords).toContain(AUP_TEST_TERMS.blocked);
    expect(firstReview?.keywords).toContain(AUP_TEST_TERMS.review);
    expect(AUP_TEST_TERMS).toEqual({
      blocked: "__cds_test_blocked__",
      review: "__cds_test_review__",
    });
  });
});
