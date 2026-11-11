// Library names and descriptions (07-12; CONT-14, D280).
import { describe, expect, it } from "vitest";
import { ALT_REQUIRED_COPY, altSuggestionFromName, cleanFileName } from "./alt";

describe("altSuggestionFromName", () => {
  it("turns a descriptive file name into a sentence", () => {
    expect(altSuggestionFromName("loaves-cooling_on-rack.jpg")).toBe(
      "Loaves cooling on rack",
    );
    expect(altSuggestionFromName("Team Photo 2024.PNG")).toBe(
      "Team photo 2024",
    );
  });

  it.each([
    "IMG_2041.JPG",
    "DSC00012.jpeg",
    "PXL_20240912_101010.jpg",
    "Screenshot 2024-09-12 at 10.10.10.png",
    "1234.png",
    "",
  ])("suggests nothing for %j", (name) => {
    expect(altSuggestionFromName(name)).toBe("");
  });

  it("ignores non-strings and caps at 250", () => {
    expect(altSuggestionFromName(42)).toBe("");
    expect(altSuggestionFromName(`${"a".repeat(400)}.jpg`).length).toBe(250);
  });
});

describe("cleanFileName", () => {
  it("strips paths, control characters and leading dots", () => {
    expect(cleanFileName("C:\\Users\\me\\IMG_2041.JPG")).toBe("IMG_2041.JPG");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("..hidden.png")).toBe("hidden.png");
    expect(cleanFileName("a\u0000b\u001fc.jpg")).toBe("abc.jpg");
  });

  it("collapses whitespace and caps at 200", () => {
    expect(cleanFileName("  my   photo\t.jpg ")).toBe("my photo .jpg");
    expect(cleanFileName("x".repeat(300)).length).toBe(200);
  });

  it("falls back to Untitled", () => {
    expect(cleanFileName("")).toBe("Untitled");
    expect(cleanFileName("...")).toBe("Untitled");
    expect(cleanFileName(undefined)).toBe("Untitled");
  });

  it("has the blank-description copy", () => {
    expect(ALT_REQUIRED_COPY).toMatch(/description/);
  });
});
