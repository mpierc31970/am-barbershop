// Social and sharing block (07-07; CONT-27, D198; no SDKs).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  SOCIAL_SHARE_DEFAULT,
  SOCIAL_SHARE_TARGETS,
  defaultSocialBlock,
  socialSection,
  validateSocialBlock,
} from "./social";

describe("social content", () => {
  it("targets and default share list", () => {
    expect([...SOCIAL_SHARE_TARGETS]).toEqual([
      "facebook",
      "x",
      "linkedin",
      "pinterest",
      "email",
      "copy",
    ]);
    expect([...SOCIAL_SHARE_DEFAULT]).toEqual([
      "facebook",
      "x",
      "email",
      "copy",
    ]);
    expect(Object.isFrozen(SOCIAL_SHARE_DEFAULT)).toBe(true);
    const d = defaultSocialBlock();
    expect(d).toEqual({
      heading: "",
      show_socials: true,
      show_share: true,
      share: ["facebook", "x", "email", "copy"],
    });
    expect(d.share).not.toBe(SOCIAL_SHARE_DEFAULT);
    expect(validateSocialBlock(d)).toEqual(d);
  });

  it("share is filtered, de-duplicated and re-ordered canonically", () => {
    expect(
      validateSocialBlock({
        share: ["copy", "x", "copy", "myspace", 5, "__proto__", "facebook"],
        show_share: false,
        evil: 1,
      }),
    ).toEqual({
      heading: "",
      show_socials: true,
      show_share: false,
      share: ["facebook", "x", "copy"],
    });
    expect(validateSocialBlock({ share: "x" }).share).toEqual([
      ...SOCIAL_SHARE_DEFAULT,
    ]);
    expect(validateSocialBlock({ share: [] }).share).toEqual([]);
    expect(() => validateSocialBlock(3)).toThrow(InvalidInput);
  });

  it("contract", () => {
    expect(socialSection.type).toBe("social");
    expect(socialSection.label).toBe("Social and sharing");
    expect(socialSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(socialSection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(socialSection.refsOf({})).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
    expect(socialSection.textsOf({ heading: "Follow" })).toEqual(["Follow"]);
    expect(socialSection.urlsOf({})).toEqual([]);
    for (const bad of [null, undefined, 5, "x", []]) {
      expect(() => socialSection.textsOf(bad)).not.toThrow();
      expect(() => socialSection.mapRichText(bad, (h) => h)).not.toThrow();
    }
  });
});
