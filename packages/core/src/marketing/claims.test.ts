import { describe, expect, it } from "vitest";
import {
  CLAIMS,
  CLAIM_ROWS,
  claimById,
  formatCheckedDate,
  oldestVerifiedDays,
  visibleClaims,
  type Claim,
} from "./claims";

const fixture = (
  id: string,
  status: Claim["status"],
  verifiedOn: string,
): Claim => ({
  id,
  text: `Claim ${id}`,
  competitor: "Example",
  figure: "1%",
  sourceUrl: "https://example.com/pricing",
  sourceTitle: "Example pricing",
  verifiedOn,
  status,
  row: "processing",
});

describe("CLAIMS shape (HUB-06, D182)", () => {
  it("every claim has an https:// source URL", () => {
    for (const c of CLAIMS)
      expect(c.sourceUrl, c.id).toMatch(/^https:\/\/[^\s]+$/);
  });

  it("every claim has a real ISO verifiedOn date", () => {
    for (const c of CLAIMS) {
      expect(c.verifiedOn, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const d = new Date(`${c.verifiedOn}T00:00:00Z`);
      expect(d.toISOString().slice(0, 10), c.id).toBe(c.verifiedOn);
    }
  });

  it("every claim has non-empty text, competitor, figure and source title", () => {
    for (const c of CLAIMS) {
      expect(c.text.trim(), c.id).not.toBe("");
      expect(c.competitor.trim(), c.id).not.toBe("");
      expect(c.figure.trim(), c.id).not.toBe("");
      expect(c.sourceTitle.trim(), c.id).not.toBe("");
      expect(CLAIM_ROWS, c.id).toContain(c.row);
    }
  });

  it("ids are unique and include every calculator rate", () => {
    const ids = CLAIMS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      "stripe-online",
      "mindbody-online",
      "boulevard-online",
      "processing-range",
      "fresha-marketplace",
      "booksy-boost",
      "vagaro-stack",
      "mindbody-contract",
      "boulevard-contract",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("all seeded claims are draft until the user verifies them", () => {
    expect(CLAIMS.every((c) => c.status === "draft")).toBe(true);
  });

  it("rate claims carry the sourced numbers", () => {
    expect(claimById("stripe-online").rate).toEqual({
      pct: 2.9,
      fixedCents: 30,
    });
    expect(claimById("mindbody-online").rate).toEqual({
      pct: 3.6,
      fixedCents: 30,
    });
    expect(claimById("boulevard-online").rate).toEqual({
      pct: 3.65,
      fixedCents: 15,
    });
    expect(claimById("fresha-marketplace").share).toMatchObject({
      pct: 20,
      minCents: 600,
    });
    expect(claimById("booksy-boost").share).toMatchObject({ pct: 30 });
    expect(claimById("vagaro-stack").monthlyCents).toBeGreaterThan(0);
  });

  it("claimById throws on an unknown id", () => {
    expect(() => claimById("nope")).toThrow(/nope/);
  });
});

describe("visibleClaims (A2-Q4)", () => {
  const mixed = [
    fixture("a", "draft", "2026-09-24"),
    fixture("b", "verified", "2026-10-01"),
    fixture("c", "draft", "2026-10-17"),
  ];

  it("production returns verified claims only", () => {
    expect(visibleClaims(mixed, true).map((c) => c.id)).toEqual(["b"]);
  });

  it("non-production returns every claim in order", () => {
    expect(visibleClaims(mixed, false).map((c) => c.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("production with only drafts returns nothing", () => {
    expect(visibleClaims(CLAIMS, true)).toEqual([]);
  });
});

describe("oldestVerifiedDays (A2-Q5)", () => {
  it("is null with no verified claims", () => {
    expect(
      oldestVerifiedDays(CLAIMS, new Date("2027-01-01T00:00:00Z")),
    ).toBeNull();
  });

  it("counts whole days from the oldest verified claim", () => {
    const all = [
      fixture("a", "verified", "2026-10-01"),
      fixture("b", "verified", "2026-09-01"),
      fixture("c", "draft", "2020-01-01"),
    ];
    expect(oldestVerifiedDays(all, new Date("2026-10-17T12:00:00Z"))).toBe(46);
  });
});

describe("formatCheckedDate", () => {
  it("formats an ISO date in en-US, UTC", () => {
    expect(formatCheckedDate("2026-09-24")).toBe("September 24, 2026");
    expect(formatCheckedDate("2026-01-01")).toBe("January 1, 2026");
  });
});
