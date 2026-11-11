// 13-16 Task 1: 14-day signed rating links (choice 3, T-13-16-02).
import { describe, expect, it } from "vitest";
import { signSupportFileLink, supportFileLinkState } from "./links";
import {
  RATING_LINK_MS,
  ratingLinkPath,
  ratingLinkState,
  signRatingLink,
} from "./rating-links";

const ID = "abcdefghij12345";
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

describe("rating links", () => {
  it("lasts 14 days", () => {
    expect(RATING_LINK_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("verifies within 14 days and is expired at 14 d + 1 ms", () => {
    const exp = NOW + RATING_LINK_MS;
    const sig = signRatingLink(ID, "up", exp);
    expect(ratingLinkState(ID, "up", exp, sig, NOW)).toBe("valid");
    expect(ratingLinkState(ID, "up", String(exp), sig, exp - 1)).toBe("valid");
    expect(ratingLinkState(ID, "up", exp, sig, NOW + RATING_LINK_MS + 1)).toBe(
      "expired",
    );
  });

  it("refuses a tampered choice, id, expiry or signature", () => {
    const exp = NOW + RATING_LINK_MS;
    const sig = signRatingLink(ID, "up", exp);
    expect(ratingLinkState(ID, "down", exp, sig, NOW)).toBe("invalid");
    expect(ratingLinkState("abcdefghij12346", "up", exp, sig, NOW)).toBe(
      "invalid",
    );
    expect(ratingLinkState(ID, "up", exp + 1, sig, NOW)).toBe("invalid");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(ratingLinkState(ID, "up", exp, flipped, NOW)).toBe("invalid");
    expect(ratingLinkState(ID, "meh", exp, sig, NOW)).toBe("invalid");
    expect(ratingLinkState(ID, "up", "x", sig, NOW)).toBe("invalid");
    expect(ratingLinkState(null, "up", exp, sig, NOW)).toBe("invalid");
  });

  it("never accepts a support-file MAC for the same id, nor the reverse", () => {
    const exp = NOW + RATING_LINK_MS;
    const fileSig = signSupportFileLink(ID, exp);
    expect(ratingLinkState(ID, "up", exp, fileSig, NOW)).toBe("invalid");
    expect(ratingLinkState(ID, "down", exp, fileSig, NOW)).toBe("invalid");
    const rateSig = signRatingLink(ID, "up", exp);
    expect(supportFileLinkState(ID, exp, rateSig, NOW)).toBe("invalid");
  });

  it("builds the hub path with t, r, e and sig", () => {
    const path = ratingLinkPath(1042, ID, "down", new Date(NOW));
    const url = new URL(path, "https://x.invalid");
    expect(url.pathname).toBe("/hub/support/tickets/1042/rate");
    expect(url.searchParams.get("t")).toBe(ID);
    expect(url.searchParams.get("r")).toBe("down");
    const e = url.searchParams.get("e");
    expect(Number(e)).toBe(NOW + RATING_LINK_MS);
    expect(
      ratingLinkState(ID, "down", e, url.searchParams.get("sig"), NOW),
    ).toBe("valid");
  });

  it("refuses bad input when signing", () => {
    expect(() => signRatingLink("bad", "up", NOW)).toThrow();
    expect(() => signRatingLink(ID, "meh" as never, NOW)).toThrow();
    expect(() => signRatingLink(ID, "up", 0)).toThrow();
    expect(() => ratingLinkPath(0, ID, "up", NOW)).toThrow();
  });
});
