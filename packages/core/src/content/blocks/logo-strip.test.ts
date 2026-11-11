// Logo strip block (07-06; CONT-27; T-07-06-01, -02, -03, -04).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  LOGO_STRIP_LIMITS,
  LOGO_STRIP_MAX_COPY,
  LOGO_STRIP_NAME_COPY,
  defaultLogoStripContent,
  logoStripSection,
  validateLogoStripContent,
} from "./logo-strip";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

const logo = (over: Record<string, unknown> = {}) => ({
  asset: "abc",
  name: "Acme",
  ...over,
});

describe("logo strip content", () => {
  it("default validates", () => {
    expect(defaultLogoStripContent()).toEqual({
      heading: "",
      grayscale: false,
      logos: [],
    });
    expect(validateLogoStripContent(defaultLogoStripContent())).toEqual(
      defaultLogoStripContent(),
    );
    expect(Object.isFrozen(LOGO_STRIP_LIMITS)).toBe(true);
  });

  it("blanks unsafe links and keeps safe ones", () => {
    const out = validateLogoStripContent({
      logos: [
        logo({ id: "a", link: "javascript:alert(1)" }),
        logo({ id: "b", link: "https://acme.example" }),
        logo({ id: "c", link: 5 }),
      ],
    });
    expect(out.logos.map((l) => l.link)).toEqual([
      "",
      "https://acme.example/",
      "",
    ]);
  });

  it("requires a name and a media asset", () => {
    expect(
      msg(() => validateLogoStripContent({ logos: [logo({ name: "  " })] })),
    ).toBe("Give each logo a name. It is read out to people who can't see it.");
    expect(
      msg(() => validateLogoStripContent({ logos: [logo({ asset: "a/b" })] })),
    ).toBe("Pick each logo from your media.");
  });

  it("refuses more than 16 logos and duplicate ids", () => {
    const over = Array.from({ length: 17 }, () => logo());
    expect(msg(() => validateLogoStripContent({ logos: over }))).toBe(
      "A logo strip holds up to 16 logos.",
    );
    expect(() =>
      validateLogoStripContent({
        logos: [logo({ id: "x" }), logo({ id: "x" })],
      }),
    ).toThrow(InvalidInput);
  });

  it("drops unknown keys and grayscale is boolean-only", () => {
    const out = validateLogoStripContent({
      grayscale: "yes",
      evil: 1,
      logos: [logo({ id: "a", extra: 1 })],
    });
    expect(out.grayscale).toBe(false);
    expect(out).not.toHaveProperty("evil");
    expect(out.logos[0]).toEqual({
      id: "a",
      asset: "abc",
      name: "Acme",
      link: "",
    });
  });
});

describe("logoStripSection", () => {
  it("contract", () => {
    expect(logoStripSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(logoStripSection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(() =>
      logoStripSection.validate(logoStripSection.defaultContent(), "full"),
    ).not.toThrow();
    const c = validateLogoStripContent({
      heading: "Partners",
      logos: [
        logo({ id: "a", asset: "m1", link: "https://a.example" }),
        logo({ id: "b", asset: "m2", name: "Beta" }),
      ],
    });
    expect(logoStripSection.refsOf(c)).toEqual({
      popups: [],
      forms: [],
      media: ["m1", "m2"],
    });
    expect(logoStripSection.textsOf(c)).toEqual(["Partners", "Acme", "Beta"]);
    expect(logoStripSection.urlsOf(c)).toEqual(["https://a.example/"]);
    expect(logoStripSection.mapRichText(c, () => "X")).toEqual(c);
  });
});

describe("logo strip copy consts (07-22)", () => {
  it("are what the validator throws", () => {
    expect(
      msg(() =>
        validateLogoStripContent({
          logos: [{ id: "a", asset: "abc", name: " " }],
        }),
      ),
    ).toBe(LOGO_STRIP_NAME_COPY);
    const logos = Array.from({ length: 17 }, (_, i) => ({
      id: `l${i}`,
      asset: "abc",
      name: "X",
    }));
    expect(msg(() => validateLogoStripContent({ logos }))).toBe(
      LOGO_STRIP_MAX_COPY,
    );
    expect(LOGO_STRIP_MAX_COPY).toBe("A logo strip holds up to 16 logos.");
  });
});
