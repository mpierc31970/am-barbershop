import { describe, expect, it } from "vitest";
import { readSocials } from "./public";
import { cleanLicense, cleanSocials } from "./seats";

describe("cleanSocials", () => {
  it("turns handles and bare domains into links, drops blanks", () => {
    expect(
      cleanSocials({
        instagram: "@fade.king",
        tiktok: "fadeking",
        x: "",
        facebook: "facebook.com/fadeking",
        other: "https://fadeking.com/book",
      }),
    ).toEqual([
      { platform: "instagram", url: "https://www.instagram.com/fade.king" },
      { platform: "tiktok", url: "https://www.tiktok.com/@fadeking" },
      { platform: "facebook", url: "https://facebook.com/fadeking" },
      { platform: "other", url: "https://fadeking.com/book" },
    ]);
  });

  it("refuses links that are not web addresses", () => {
    expect(() => cleanSocials({ other: "javascript:alert(1)" })).toThrow();
    expect(() => cleanSocials({ facebook: "not a link" })).toThrow();
  });
});

describe("readSocials", () => {
  it("keeps only known platforms with http(s) links", () => {
    expect(
      readSocials([
        { platform: "instagram", url: "https://instagram.com/a" },
        { platform: "myspace", url: "https://myspace.com/a" },
        { platform: "x", url: "javascript:alert(1)" },
        "junk",
      ]),
    ).toEqual([{ platform: "instagram", url: "https://instagram.com/a" }]);
  });
});

describe("cleanLicense", () => {
  it("uppercases, allows blank, refuses symbols", () => {
    expect(cleanLicense(" bb12345 ")).toBe("BB12345");
    expect(cleanLicense("")).toBe("");
    expect(() => cleanLicense("12<3")).toThrow();
  });
});
