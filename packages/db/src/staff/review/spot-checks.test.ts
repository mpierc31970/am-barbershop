// 13-29 (P13-P26, D248): spot-check site selection is pure; the week key and Monday test are
// America/Chicago calendar based (DST-safe).
import { describe, expect, it } from "vitest";
import {
  isSpotCheckDay,
  pickSpotCheckSites,
  spotCheckWeekKey,
  type SpotCheckCandidate,
} from "./spot-checks";

const NOW = new Date("2026-10-12T15:00:00.000Z"); // Mon 12 Oct, 10:00 am Chicago
const DAY = 86_400_000;

function c(
  orgId: string,
  launchedDaysAgo: number | null,
  changed: number,
  demo = false,
): SpotCheckCandidate {
  return {
    orgId,
    launchedAt:
      launchedDaysAgo === null
        ? null
        : new Date(NOW.getTime() - launchedDaysAgo * DAY).toISOString(),
    changedPages7d: changed,
    demo,
  };
}

const EIGHT: SpotCheckCandidate[] = [
  c("old-a", 200, 9),
  c("new-older", 20, 0),
  c("old-b", 300, 7),
  c("demo", 2, 50, true),
  c("new-newest", 3, 1),
  c("old-c", 100, 5),
  c("old-d", 400, 2),
  c("old-e", 500, 0),
];

describe("pickSpotCheckSites", () => {
  it("returns 5: the 2 new sites first (newest first), never the demo, then most changed, 5th random", () => {
    const picked = pickSpotCheckSites(EIGHT, { now: NOW, rng: () => 0 });
    expect(picked).toHaveLength(5);
    expect(picked.slice(0, 2)).toEqual(["new-newest", "new-older"]);
    expect(picked).not.toContain("demo");
    expect(picked.slice(2, 4)).toEqual(["old-a", "old-b"]);
    // Ranked 5th would be old-c; the seat goes to the first of the rest [old-d, old-e].
    expect(picked[4]).toBe("old-d");
    expect(pickSpotCheckSites(EIGHT, { now: NOW, rng: () => 0.99 })[4]).toBe(
      "old-e",
    );
  });

  it("keeps all when 5 or fewer are eligible, and skips non-live sites", () => {
    const few = [c("a", 1, 0), c("b", 90, 3), { ...c("x", 1, 9), live: false }];
    expect(pickSpotCheckSites(few, { now: NOW, rng: () => 0 })).toEqual([
      "a",
      "b",
    ]);
    expect(pickSpotCheckSites([], { now: NOW })).toEqual([]);
  });

  it("is deterministic for a fixed rng", () => {
    const a = pickSpotCheckSites(EIGHT, { now: NOW, rng: () => 0.5 });
    const b = pickSpotCheckSites(EIGHT, { now: NOW, rng: () => 0.5 });
    expect(a).toEqual(b);
  });
});

describe("week key and Monday", () => {
  it("uses the America/Chicago day (Monday 00:30 Chicago is Monday 05:30 UTC)", () => {
    expect(isSpotCheckDay(NOW)).toBe(true);
    expect(isSpotCheckDay(new Date("2026-10-12T04:30:00.000Z"))).toBe(false); // Sun 11:30 pm Chicago
    expect(isSpotCheckDay(new Date("2026-10-13T15:00:00.000Z"))).toBe(false);
    expect(spotCheckWeekKey(NOW)).toBe("review:spot:2026-w42");
    expect(spotCheckWeekKey(new Date("2026-10-18T15:00:00.000Z"))).toBe(
      "review:spot:2026-w42",
    );
    expect(spotCheckWeekKey(new Date("2027-01-01T18:00:00.000Z"))).toBe(
      "review:spot:2026-w53",
    );
  });
});
