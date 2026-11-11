// Gallery / logo strip editor logic (07-22; CONT-22, CONT-27, decision 6).
import { describe, expect, it } from "vitest";
import type { GalleryImage, LogoStripLogo } from "@cds/core/content";
import type { PickedMedia } from "../../hub/media/copy";
import {
  altFromFileName,
  countNeedingDescription,
  galleryImagesFromPicks,
  logosFromPicks,
  moveItem,
  nextNeedingDescription,
} from "./gallery-logic";

function pick(id: string, over: Partial<PickedMedia> = {}): PickedMedia {
  return {
    id,
    kind: "image",
    name: `${id}.jpg`,
    alt: "",
    thumbUrl: null,
    width: 800,
    height: 600,
    needsDescription: true,
    ...over,
  };
}

function ids() {
  let n = 0;
  return () => `n${++n}`;
}

describe("altFromFileName", () => {
  it("mirrors the library suggestion", () => {
    expect(altFromFileName("loaves-cooling_on-rack.jpg")).toBe(
      "Loaves cooling on rack",
    );
    for (const camera of [
      "IMG_2041.JPG",
      "DSC00012.jpeg",
      "PXL_20240912_101010.jpg",
      "Screenshot 2024-09-12 at 10.10.10.png",
      "1234.png",
      "",
    ]) {
      expect(altFromFileName(camera), camera).toBe("");
    }
    expect(altFromFileName(42)).toBe("");
  });
});

describe("galleryImagesFromPicks", () => {
  it("appends in order with the pre-fill rule", () => {
    const existing: GalleryImage[] = [
      { id: "a", asset: "m0", alt: "", alt_reviewed: true, caption: "" },
    ];
    const r = galleryImagesFromPicks(
      existing,
      [
        pick("m1", { needsDescription: false, alt: "Shop front" }),
        pick("m2", { name: "IMG_2041.jpg" }),
        pick("m3", { name: "loaves.jpg" }),
        pick("m0"),
        pick("m3"),
        pick("v1", { kind: "video" }),
      ],
      ids(),
    );
    expect(r.overflow).toBe(false);
    expect(r.added).toHaveLength(3);
    expect(r.images.map((i) => [i.asset, i.alt, i.alt_reviewed])).toEqual([
      ["m0", "", true],
      ["m1", "", true],
      ["m2", "Photo 3", false],
      ["m3", "Loaves", false],
    ]);
  });

  it("stops at 200 and reports overflow", () => {
    const existing = Array.from({ length: 198 }, (_, i) => ({
      id: `i${i}`,
      asset: `a${i}`,
      alt: "",
      alt_reviewed: true,
      caption: "",
    }));
    const r = galleryImagesFromPicks(
      existing,
      [pick("x1"), pick("x2"), pick("x3")],
      ids(),
    );
    expect(r.images).toHaveLength(200);
    expect(r.images.at(-1)?.asset).toBe("x2");
    expect(r.overflow).toBe(true);
  });
});

describe("logosFromPicks", () => {
  it("names from the library, else the file name, capped at 16", () => {
    const existing: LogoStripLogo[] = Array.from({ length: 14 }, (_, i) => ({
      id: `l${i}`,
      asset: `a${i}`,
      name: "X",
      link: "",
    }));
    const r = logosFromPicks(
      existing,
      [
        pick("m1", { needsDescription: false, alt: "Acme" }),
        pick("m2", { name: "beta-co-logo.png" }),
        pick("m3"),
      ],
      ids(),
    );
    expect(r.logos.slice(14).map((l) => [l.asset, l.name, l.link])).toEqual([
      ["m1", "Acme", ""],
      ["m2", "Beta co logo", ""],
    ]);
    expect(r.overflow).toBe(true);
  });

  it("a camera name leaves the name blank", () => {
    const r = logosFromPicks([], [pick("m1", { name: "IMG_1.png" })], ids());
    expect(r.logos[0].name).toBe("");
  });
});

describe("moveItem / nextNeedingDescription", () => {
  it("moveItem is pure and ignores bad moves", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(list, 0, 5)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("finds the next amber photo, wrapping, never the current one", () => {
    const imgs = [
      { alt_reviewed: false },
      { alt_reviewed: true },
      { alt_reviewed: false },
    ];
    expect(nextNeedingDescription(imgs, 0)).toBe(2);
    expect(nextNeedingDescription(imgs, 2)).toBe(0);
    expect(nextNeedingDescription(imgs, -1)).toBe(0);
    expect(nextNeedingDescription([{ alt_reviewed: false }], 0)).toBe(-1);
    expect(countNeedingDescription(imgs)).toBe(2);
  });
});
