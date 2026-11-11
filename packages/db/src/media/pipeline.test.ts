// processImage (ONB-04; RESEARCH Pattern 4, Pitfalls 6-8; T-06-63..65).
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  bandPixels,
  bandPng,
  exifJpeg,
  heicBytes,
  solidPng,
  textBytes,
  transparentPng,
} from "./__fixtures__/make-fixtures";
import {
  deriveWidths,
  LIBRARY_WIDTHS,
  MAX_UPLOAD_BYTES,
  processImage,
  sniffFormat,
  UploadRejected,
} from "./pipeline";
import { createQueue, imageQueue } from "./queue";

async function rejection(p: Promise<unknown>): Promise<UploadRejected> {
  try {
    await p;
  } catch (err) {
    if (err instanceof UploadRejected) return err;
    throw err;
  }
  throw new Error("expected an UploadRejected");
}

describe("processImage", () => {
  it("orients an EXIF-6 JPEG upright and strips EXIF/GPS from every variant", async () => {
    const input = await exifJpeg();
    const inMeta = await sharp(input).metadata();
    expect(inMeta.orientation).toBe(6);
    expect(inMeta.exif).toBeDefined();
    expect(inMeta.width).toBe(60);

    const out = await processImage(input);
    expect(out.format).toBe("jpeg");
    expect([out.width, out.height]).toEqual([40, 60]);
    expect([out.web.width, out.web.height]).toEqual([40, 60]);
    for (const bytes of [out.original, out.web.data, out.thumb.data]) {
      const m = await sharp(bytes).metadata();
      expect(m.exif).toBeUndefined();
      expect(m.orientation).toBeUndefined();
      expect([m.width, m.height]).toEqual([40, 60]);
    }
    expect((await sharp(out.original).metadata()).format).toBe("jpeg");
  });

  it("resizes a 3000x2000 PNG to web 2560x1707 and thumb 400x267 WebP, keeps a PNG original", async () => {
    const out = await processImage(await solidPng(3000, 2000));
    expect(out.format).toBe("png");
    expect([out.web.width, out.web.height]).toEqual([2560, 1707]);
    expect([out.thumb.width, out.thumb.height]).toEqual([400, 267]);
    const web = await sharp(out.web.data).metadata();
    const thumb = await sharp(out.thumb.data).metadata();
    const orig = await sharp(out.original).metadata();
    expect(web.format).toBe("webp");
    expect(thumb.format).toBe("webp");
    expect(orig.format).toBe("png");
    expect([orig.width, orig.height]).toEqual([3000, 2000]);
  });

  it("never enlarges a small transparent PNG", async () => {
    const out = await processImage(await transparentPng(40, 30));
    expect([out.web.width, out.web.height]).toEqual([40, 30]);
    expect([out.thumb.width, out.thumb.height]).toEqual([40, 30]);
    expect([out.palettePixels.width, out.palettePixels.height]).toEqual([
      40, 30,
    ]);
    expect((await sharp(out.web.data).metadata()).hasAlpha).toBe(true);
  });

  it("returns lossless sRGB RGBA palette pixels for a small PNG", async () => {
    const px = bandPixels();
    const out = await processImage(await bandPng(px));
    expect(out.palettePixels.width).toBe(px.width);
    expect(out.palettePixels.height).toBe(px.height);
    expect(out.palettePixels.data.length).toBe(px.width * px.height * 4);
    expect(
      Buffer.from(out.palettePixels.data).equals(Buffer.from(px.data)),
    ).toBe(true);
  });

  it("caps the palette sample at 128 px on the long side", async () => {
    const out = await processImage(await solidPng(1000, 500));
    expect([out.palettePixels.width, out.palettePixels.height]).toEqual([
      128, 64,
    ]);
  });

  it("refuses a raw HEIC with the iPhone copy", async () => {
    const err = await rejection(processImage(heicBytes()));
    expect(err.reason).toBe("heic");
    expect(err.message).toBe(
      "We couldn't read this iPhone photo. Save it as a JPEG and try again.",
    );
  });

  it("refuses a text file renamed .jpg", async () => {
    const err = await rejection(processImage(textBytes()));
    expect(err.reason).toBe("type");
    expect(err.message).toBe(
      "This file isn't a photo we can use. Upload a JPEG, PNG or WebP.",
    );
  });

  it("refuses bytes whose header disagrees with the decoder (JPEG magic, garbage body)", async () => {
    const fake = new Uint8Array(200);
    fake.set([0xff, 0xd8, 0xff, 0xe0]);
    const err = await rejection(processImage(fake));
    expect(err.reason).toBe("type");
  });

  it("refuses a 10000x10000 PNG over the 50 MP cap", async () => {
    const err = await rejection(processImage(await solidPng(10000, 10000)));
    expect(err.reason).toBe("pixels");
  }, 60_000);

  it("refuses more than 20 MB before decoding, with the size in MB", async () => {
    const err = await rejection(
      processImage(new Uint8Array(MAX_UPLOAD_BYTES + 1024 * 1024 * 13)),
    );
    expect(err.reason).toBe("too_big");
    expect(err.message).toBe(
      "This photo is 33 MB. The limit is 20 MB: export a smaller copy and try again.",
    );
  });

  it("sniffs JPEG, PNG, WebP and HEIC brands", async () => {
    expect(sniffFormat(await exifJpeg())).toBe("jpeg");
    expect(sniffFormat(await solidPng(4, 4))).toBe("png");
    const webp = new Uint8Array(
      await sharp(await solidPng(4, 4))
        .webp()
        .toBuffer(),
    );
    expect(sniffFormat(webp)).toBe("webp");
    expect(sniffFormat(heicBytes())).toBe("heic");
    expect(sniffFormat(textBytes())).toBeNull();
  });

  it("processes a WebP upload and keeps a WebP original", async () => {
    const webp = new Uint8Array(
      await sharp(await solidPng(50, 20))
        .webp()
        .toBuffer(),
    );
    const out = await processImage(webp);
    expect(out.format).toBe("webp");
    expect((await sharp(out.original).metadata()).format).toBe("webp");
  });
});

describe("library widths (07-12)", () => {
  it("lists the three library widths", () => {
    expect(LIBRARY_WIDTHS).toEqual([480, 960, 1600]);
  });

  it("a 2000x1000 JPEG gets w480, w960, w1600 plus web 2000 and thumb, all WebP and stripped", async () => {
    const jpeg = new Uint8Array(
      await sharp(await solidPng(2000, 1000))
        .jpeg()
        .toBuffer(),
    );
    const out = await processImage(jpeg);
    expect(Object.keys(out.widths).sort()).toEqual(["w1600", "w480", "w960"]);
    expect([out.widths.w480!.width, out.widths.w480!.height]).toEqual([
      480, 240,
    ]);
    expect(out.widths.w960!.width).toBe(960);
    expect(out.widths.w1600!.width).toBe(1600);
    expect(out.web.width).toBe(2000);
    for (const w of Object.values(out.widths)) {
      const m = await sharp(w!.data).metadata();
      expect(m.format).toBe("webp");
      expect(m.exif).toBeUndefined();
    }
  });

  it("a 700x500 PNG gets only w480; a 400x900 image gets none", async () => {
    const a = await processImage(await solidPng(700, 500));
    expect(Object.keys(a.widths)).toEqual(["w480"]);
    const b = await processImage(await solidPng(400, 900));
    expect(Object.keys(b.widths)).toEqual([]);
  });

  it("orients before measuring: an EXIF-6 JPEG keeps no widths at its 40 px upright width", async () => {
    const out = await processImage(await exifJpeg());
    expect(out.widths).toEqual({});
  });

  it("deriveWidths rebuilds the same set from a stored original", async () => {
    const out = await processImage(await solidPng(1000, 500));
    const again = await deriveWidths(out.original, out.width);
    expect(Object.keys(again).sort()).toEqual(["w480", "w960"]);
    expect(again.w960!.width).toBe(960);
    expect((await sharp(again.w480!.data).metadata()).format).toBe("webp");
  });
});

describe("image queue", () => {
  it("runs jobs one at a time, in order, and survives a failure", async () => {
    const q = createQueue();
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];
    const job =
      (n: number, fail = false) =>
      async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        order.push(n);
        running -= 1;
        if (fail) throw new Error("boom");
        return n;
      };
    const results = await Promise.allSettled([
      q.run(job(1)),
      q.run(job(2, true)),
      q.run(job(3)),
    ]);
    expect(maxRunning).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    expect(q.pending).toBe(0);
  });

  it("serialises two concurrent processImage calls", async () => {
    const [one, two] = [await solidPng(800, 600), await solidPng(600, 800)];
    const pa = processImage(one);
    const pb = processImage(two);
    expect(imageQueue.pending).toBe(2);
    const [a, b] = await Promise.all([pa, pb]);
    expect(imageQueue.pending).toBe(0);
    expect([a.web.width, b.web.width]).toEqual([800, 600]);
  });
});
