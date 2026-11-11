// 07-22 decision 6: the gallery editor's description pre-fill (`altFromFileName`, @cds/ui) is a
// mirror of the library's `altSuggestionFromName` (@cds/db, 07-12): @cds/ui cannot import
// @cds/db. This test pins the two together over 07-12's corpus (07-17 copy-drift precedent).
import { altSuggestionFromName } from "@cds/db";
import { describe, expect, it } from "vitest";
import { altFromFileName } from "../../../packages/ui/src/builder/blocks/gallery-logic";

const CORPUS = [
  "loaves-cooling_on-rack.jpg",
  "Team Photo 2024.PNG",
  "IMG_2041.JPG",
  "DSC00012.jpeg",
  "PXL_20240912_101010.jpg",
  "Screenshot 2024-09-12 at 10.10.10.png",
  "1234.png",
  "",
  `${"a".repeat(400)}.jpg`,
  "Our-New_Shop front.JPEG",
  "  .png",
  "C:\\Users\\me\\IMG_2041.JPG",
  "folder/sourdough_starter.webp",
  "a\u0000b\u001fc.jpg",
];

describe("gallery alt pre-fill drift (@cds/ui vs @cds/db)", () => {
  it.each(CORPUS)("matches for %j", (name) => {
    expect(altFromFileName(name)).toBe(altSuggestionFromName(name));
  });

  it("matches for non-strings", () => {
    for (const v of [42, null, undefined, {}]) {
      expect(altFromFileName(v)).toBe(altSuggestionFromName(v));
    }
  });
});
