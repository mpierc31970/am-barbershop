// preview. and review. tokens (14-16 choices 1 and 3; DOM-07, D22, D172; T-14-16-02, T-14-16-03).
import { InvalidInput } from "@cds/core";
import { describe, expect, it } from "vitest";
import { signRatingLink } from "../support/rating-links";
import {
  PREVIEW_LINK_MS,
  REVIEW_LINK_MS,
  signPreviewToken,
  signReviewToken,
  verifyPreviewToken,
  verifyReviewToken,
} from "./preview-links";

const ORG = "aaaaaaaaaaaaaa1";
const ORG_B = "bbbbbbbbbbbbbb2";
const PAGE = "ppppppppppppp01";
const MEMBER = "mmmmmmmmmmmmm01";
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

function flip(sig: string): string {
  const c = sig[0] === "A" ? "B" : "A";
  return c + sig.slice(1);
}

describe("preview tokens", () => {
  it("round-trips a valid token with a 60-minute expiry", () => {
    const t = signPreviewToken(ORG, PAGE, NOW);
    expect(t.startsWith(`v1.${ORG}.${PAGE}.`)).toBe(true);
    expect(verifyPreviewToken(t, NOW + 1000)).toEqual({
      status: "valid",
      orgId: ORG,
      pageId: PAGE,
      expiresAt: NOW + PREVIEW_LINK_MS,
    });
    expect(PREVIEW_LINK_MS).toBe(60 * 60 * 1000);
  });

  it("expires at 60 minutes", () => {
    const t = signPreviewToken(ORG, PAGE, NOW);
    expect(verifyPreviewToken(t, NOW + PREVIEW_LINK_MS).status).toBe("expired");
    expect(
      verifyPreviewToken(t, new Date(NOW + PREVIEW_LINK_MS - 1)).status,
    ).toBe("valid");
  });

  it("refuses tampered fields and signatures", () => {
    const t = signPreviewToken(ORG, PAGE, NOW);
    const [v, o, p, e, s] = t.split(".");
    const cases = [
      [v, ORG_B, p, e, s],
      [v, o, "ppppppppppppp02", e, s],
      [v, o, p, String(Number(e) + 1), s],
      [v, o, p, e, flip(s!)],
      ["v2", o, p, e, s],
      [v, o, p, e],
      [v, o, p, e, s, "x"],
      [v, o, p, e, `${s!.slice(0, 42)}`],
      [v, o.toUpperCase(), p, e, s],
    ];
    for (const c of cases) {
      expect(verifyPreviewToken(c.join("."), NOW).status).toBe("invalid");
    }
  });

  it("never throws on junk", () => {
    for (const junk of [undefined, null, 42, {}, "", "....", "x".repeat(500)]) {
      expect(verifyPreviewToken(junk, NOW).status).toBe("invalid");
    }
    expect(
      verifyPreviewToken(signPreviewToken(ORG, PAGE, NOW), NaN).status,
    ).toBe("invalid");
  });

  it("signing rejects bad ids", () => {
    expect(() => signPreviewToken("bad", PAGE, NOW)).toThrow(InvalidInput);
    expect(() => signPreviewToken(ORG, "../etc", NOW)).toThrow(InvalidInput);
  });

  it("a rating. or review. MAC never verifies as preview. (cross-purpose)", () => {
    const exp = NOW + PREVIEW_LINK_MS;
    const rating = signRatingLink(ORG, "up", exp);
    expect(
      verifyPreviewToken(`v1.${ORG}.${PAGE}.${exp}.${rating}`, NOW).status,
    ).toBe("invalid");
    const review = signReviewToken(ORG, PAGE, "review", NOW).split(".")[5];
    expect(
      verifyPreviewToken(`v1.${ORG}.${PAGE}.${exp}.${review}`, NOW).status,
    ).toBe("invalid");
  });
});

describe("review tokens", () => {
  it("round-trips both modes", () => {
    for (const mode of ["review", "phone"] as const) {
      const t = signReviewToken(ORG, MEMBER, mode, NOW);
      expect(verifyReviewToken(t, NOW)).toEqual({
        status: "valid",
        orgId: ORG,
        memberId: MEMBER,
        mode,
        expiresAt: NOW + REVIEW_LINK_MS,
      });
    }
  });

  it("expires, and refuses a swapped mode, org or member", () => {
    const t = signReviewToken(ORG, MEMBER, "review", NOW);
    expect(verifyReviewToken(t, NOW + REVIEW_LINK_MS).status).toBe("expired");
    const [v, o, m, mode, e, s] = t.split(".");
    expect(mode).toBe("review");
    for (const c of [
      [v, o, m, "phone", e, s],
      [v, ORG_B, m, mode, e, s],
      [v, o, "mmmmmmmmmmmmm02", mode, e, s],
      [v, o, m, "admin", e, s],
      [v, o, m, mode, e, flip(s!)],
    ]) {
      expect(verifyReviewToken(c.join("."), NOW).status).toBe("invalid");
    }
  });

  it("a preview. MAC never verifies as review., and the reverse", () => {
    const p = signPreviewToken(ORG, MEMBER, NOW);
    const [, , , e, s] = p.split(".");
    expect(
      verifyReviewToken(`v1.${ORG}.${MEMBER}.review.${e}.${s}`, NOW).status,
    ).toBe("invalid");
    expect(verifyReviewToken(p, NOW).status).toBe("invalid");
    expect(
      verifyPreviewToken(signReviewToken(ORG, MEMBER, "phone", NOW), NOW)
        .status,
    ).toBe("invalid");
  });

  it("signing rejects a bad mode", () => {
    expect(() =>
      signReviewToken(ORG, MEMBER, "admin" as unknown as "review", NOW),
    ).toThrow(InvalidInput);
  });
});
