import { describe, expect, it } from "vitest";
import {
  RATING_COMMENT_MAX,
  canRate,
  isRatingChoice,
  ratingRate,
} from "./rating";

const base = { isFiler: false, impersonated: false };

describe("canRate (13-16 choice 1)", () => {
  it("lets Owner, Admin and Editor rate a resolved ticket", () => {
    for (const role of ["owner", "admin", "editor"]) {
      expect(canRate({ ...base, status: "resolved", role })).toBe(true);
    }
  });

  it("refuses a viewer who did not file it, but allows the filer", () => {
    expect(canRate({ ...base, status: "resolved", role: "viewer" })).toBe(
      false,
    );
    expect(
      canRate({ ...base, status: "resolved", role: "viewer", isFiler: true }),
    ).toBe(true);
  });

  it("refuses every status but resolved", () => {
    for (const status of ["open", "in_progress", "waiting_on_you", "closed"]) {
      expect(canRate({ ...base, status, role: "owner" })).toBe(false);
    }
  });

  it("refuses under impersonation", () => {
    expect(
      canRate({
        status: "resolved",
        role: "owner",
        isFiler: true,
        impersonated: true,
      }),
    ).toBe(false);
  });
});

describe("ratingRate", () => {
  it("rounds the thumbs-up share and is null with nothing rated", () => {
    expect(ratingRate(21, 2)).toBe(91);
    expect(ratingRate(0, 1)).toBe(0);
    expect(ratingRate(1, 0)).toBe(100);
    expect(ratingRate(0, 0)).toBeNull();
    expect(ratingRate(-1, Number.NaN)).toBeNull();
  });
});

describe("choices and cap", () => {
  it("accepts up and down only, with a 500 cap", () => {
    expect(RATING_COMMENT_MAX).toBe(500);
    expect(isRatingChoice("up")).toBe(true);
    expect(isRatingChoice("down")).toBe(true);
    expect(isRatingChoice("meh")).toBe(false);
  });
});
