// Test fixtures for the image pipeline, generated at test time with sharp (no committed
// binaries). Used by pipeline.test.ts and the media integration test.
import sharp from "sharp";

const u8 = (b: Buffer): Uint8Array => new Uint8Array(b);

/** A solid-colour PNG of any size (RGB). */
export async function solidPng(
  width: number,
  height: number,
  colour = { r: 180, g: 90, b: 40 },
): Promise<Uint8Array> {
  return u8(
    await sharp({ create: { width, height, channels: 3, background: colour } })
      .png()
      .toBuffer(),
  );
}

/** A small transparent PNG (RGBA, alpha 0). */
export async function transparentPng(
  width = 40,
  height = 30,
): Promise<Uint8Array> {
  return u8(
    await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer(),
  );
}

/**
 * A 60x40 (raw, landscape) JPEG carrying EXIF Orientation 6 (rotate 90 CW to view) plus a
 * GPS position and a camera tag. Upright it is 40x60.
 */
export async function exifJpeg(): Promise<Uint8Array> {
  return u8(
    await sharp({
      create: {
        width: 60,
        height: 40,
        channels: 3,
        background: { r: 20, g: 120, b: 200 },
      },
    })
      .jpeg({ quality: 90 })
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Make: "CDS Test Camera", Copyright: "fixture" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "30/1 16/1 0/1",
          GPSLongitudeRef: "W",
          GPSLongitude: "97/1 44/1 0/1",
        },
      })
      .toBuffer(),
  );
}

/** Raw RGBA pixels for a 96x64 image of four vertical colour bands. */
export function bandPixels(): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  const width = 96;
  const height = 64;
  const bands = [
    [200, 60, 50],
    [30, 90, 160],
    [240, 220, 180],
    [40, 40, 40],
  ] as const;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = bands[Math.floor((x * bands.length) / width)]!;
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** The band pixels encoded losslessly as a PNG (decodes back to exactly bandPixels()). */
export async function bandPng(px = bandPixels()): Promise<Uint8Array> {
  return u8(
    await sharp(px.data, {
      raw: { width: px.width, height: px.height, channels: 4 },
    })
      .png()
      .toBuffer(),
  );
}

/** A second, differently coloured band image (greens), for reorder tests. */
export function greenPixels(): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  const px = bandPixels();
  for (let i = 0; i < px.data.length; i += 4) {
    const r = px.data[i]!;
    px.data[i] = Math.floor(r / 4);
    px.data[i + 1] = 150 + ((px.data[i + 1]! / 3) | 0);
    px.data[i + 2] = Math.floor(px.data[i + 2]! / 3);
  }
  return px;
}

/** Bytes that claim to be HEIC (ISO BMFF "ftypheic" at offset 4). */
export function heicBytes(): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0, 0, 0, 24], 0);
  b.set(new TextEncoder().encode("ftypheic"), 4);
  return b;
}

/** A text file (e.g. renamed to .jpg). */
export function textBytes(): Uint8Array {
  return new TextEncoder().encode("This is not a photo, just some text.\n");
}
