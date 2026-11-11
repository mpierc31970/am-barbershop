// makeVideoPosters (07-13 choice 8; T-07-13-05): JPEG + WebP + 400 px thumb, no EXIF.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { exifJpeg } from "../__fixtures__/make-fixtures";
import { makeVideoPosters } from "./poster";

describe("makeVideoPosters", () => {
  it("re-encodes a frame into jpg, webp and thumb without metadata", async () => {
    const frame = await sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 3,
        background: { r: 200, g: 40, b: 40 },
      },
    })
      .withMetadata({ exif: { IFD0: { Copyright: "phone" } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(frame).metadata()).exif).toBeDefined();
    const p = await makeVideoPosters(new Uint8Array(frame));
    const jm = await sharp(p.jpg).metadata();
    const wm = await sharp(p.webp).metadata();
    const tm = await sharp(p.thumb).metadata();
    expect(jm.format).toBe("jpeg");
    expect(wm.format).toBe("webp");
    expect(tm.format).toBe("webp");
    expect(Math.max(tm.width!, tm.height!)).toBeLessThanOrEqual(400);
    expect(p).toMatchObject({ width: 1280, height: 720 });
    for (const m of [jm, wm, tm]) expect(m.exif).toBeUndefined();
  });

  it("drops the EXIF block of a camera JPEG", async () => {
    const p = await makeVideoPosters(await exifJpeg());
    expect((await sharp(p.jpg).metadata()).exif).toBeUndefined();
  });
});
