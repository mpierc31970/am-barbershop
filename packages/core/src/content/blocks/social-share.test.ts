// Share URLs and social link labels (07-24; CONT-27, D198; T-07-24-01).
import { describe, expect, it } from "vitest";
import {
  SOCIAL_SHARE_LABELS,
  socialLinkLabel,
  socialShareHref,
} from "./social-share";
import { SOCIAL_SHARE_TARGETS } from "./social";

const PAGE = { url: "https://rivera.example/menu", title: "Our menu" };
const ENC = encodeURIComponent("https://rivera.example/menu");

describe("socialShareHref", () => {
  it("builds plain share URLs", () => {
    expect(socialShareHref("facebook", PAGE)).toBe(
      `https://www.facebook.com/sharer/sharer.php?u=${ENC}`,
    );
    expect(socialShareHref("x", PAGE)).toBe(
      `https://x.com/intent/tweet?url=${ENC}&text=Our%20menu`,
    );
    expect(socialShareHref("linkedin", PAGE)).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${ENC}`,
    );
    expect(socialShareHref("pinterest", PAGE)).toBe(
      `https://www.pinterest.com/pin/create/button/?url=${ENC}&description=Our%20menu`,
    );
    expect(socialShareHref("email", PAGE)).toBe(
      `mailto:?subject=Our%20menu&body=${ENC}`,
    );
    expect(socialShareHref("copy", PAGE)).toBeNull();
  });

  it("refuses non-http(s) page URLs for every target", () => {
    for (const t of SOCIAL_SHARE_TARGETS) {
      expect(
        socialShareHref(t, { url: "javascript:alert(1)", title: "x" }),
      ).toBeNull();
      expect(socialShareHref(t, { url: "not a url", title: "x" })).toBeNull();
    }
  });

  it("percent-encodes hostile titles", () => {
    const href = socialShareHref("x", { url: PAGE.url, title: `a&b<c>"d` })!;
    expect(href).toContain("text=a%26b%3Cc%3E%22d");
    expect(href).not.toMatch(/[<>"]/);
  });

  it("labels the six targets", () => {
    expect(SOCIAL_SHARE_TARGETS.map((t) => SOCIAL_SHARE_LABELS[t])).toEqual([
      "Facebook",
      "X",
      "LinkedIn",
      "Pinterest",
      "Email",
      "Copy link",
    ]);
  });
});

describe("socialLinkLabel", () => {
  it("names the business and platform", () => {
    expect(
      socialLinkLabel("Rivera Bakery", {
        platform: "instagram",
        url: "https://instagram.com/rivera",
      }),
    ).toBe("Rivera Bakery on Instagram");
  });
  it("other uses the host without www", () => {
    expect(
      socialLinkLabel("Rivera Bakery", {
        platform: "other",
        url: "https://www.yelp.com/biz/x",
      }),
    ).toBe("Rivera Bakery on yelp.com");
  });
  it("a custom account (11-35) uses its name; the new presets have labels", () => {
    expect(
      socialLinkLabel("Rivera Bakery", {
        platform: "other",
        url: "https://www.etsy.com/shop/rivera",
        label: "Etsy",
      }),
    ).toBe("Rivera Bakery on Etsy");
    expect(
      socialLinkLabel("Rivera Bakery", {
        platform: "threads",
        url: "https://threads.net/@rivera",
      }),
    ).toBe("Rivera Bakery on Threads");
  });

  it("no name gives just the platform", () => {
    expect(
      socialLinkLabel("", {
        platform: "instagram",
        url: "https://instagram.com/x",
      }),
    ).toBe("Instagram");
  });
});
