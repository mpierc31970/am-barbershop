// The image pipeline (ONB-04, CONTEXT A4-Q1, RESEARCH Pattern 4 and Pitfalls 6-8; T-06-63..65).
// Internal to @cds/db/media: uploadImage (assets.ts) is the only caller.
//
//   1. size cap (20 MB) and a magic-byte sniff: JPEG, PNG, WebP; a raw HEIC gets its own copy
//   2. sharp metadata must agree with the sniff (a text file renamed .jpg is refused)
//   3. pixel cap 50 MP (decompression bombs), checked from the header and by libvips
//   4. every output is auto-oriented and metadata-stripped (sharp's default output drops EXIF,
//      GPS and ICC); the kept "original" is a full-resolution re-encode in its own format
//      (PNG lossless, JPEG/WebP quality 92; PD-15), never the uploaded bytes (Pitfall 7)
//   5. web.webp inside 2560 px (q82), thumb.webp inside 400 px (q75), never enlarged
//   5b. library widths (07-12, D255): w480/w960/w1600 WebP q80, width-only, generated only for
//       N below the upright width (never enlarged); deriveWidths() rebuilds them from a stored
//       original for publish-time backfill of P6 photos
//   6. palettePixels: <= 128 px sRGB RGBA for the server mood board palette (Pattern 5)
// Work runs through a queue of one and sharp.concurrency(1) for the 1 GB / 1 CPU container.
import { InvalidInput } from "@cds/core";
import type { Metadata, Sharp } from "sharp";
import { imageQueue } from "./queue";

type SharpFn = typeof import("sharp").default;
let loaded: Promise<SharpFn> | null = null;

/**
 * sharp is loaded on first use, not at import: every page and CLI imports @cds/db, and only
 * uploads need the native module (memory on the 1 GB container, Pitfall 8).
 */
function lib(): Promise<SharpFn> {
  loaded ??= import("sharp").then((m) => {
    m.default.concurrency(1);
    return m.default;
  });
  return loaded;
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 50_000_000;
export const WEB_MAX_SIDE = 2560;
export const THUMB_MAX_SIDE = 400;
export const PALETTE_SAMPLE_SIDE = 128;
/** Width-only WebP derivatives (07-12 choice 3); w2560 is web.webp. */
export const LIBRARY_WIDTHS = [480, 960, 1600] as const;
export type LibraryWidthVariant = "w480" | "w960" | "w1600";

export type UploadRejectReason =
  "too_big" | "type" | "heic" | "pixels" | "limit";

const MB = 1024 * 1024;

/** UI-SPEC copy rows UPL-* (06-UI-SPEC copy table). */
export const UPLOAD_COPY = {
  tooBig: (bytes: number) =>
    `This photo is ${Math.max(21, Math.ceil(bytes / MB))} MB. The limit is 20 MB: export a smaller copy and try again.`,
  type: "This file isn't a photo we can use. Upload a JPEG, PNG or WebP.",
  heic: "We couldn't read this iPhone photo. Save it as a JPEG and try again.",
  pixels:
    "This photo is too large to process (over 50 megapixels). Export a smaller copy and try again.",
  failed: "The upload didn't finish. Check your connection and try again.",
  limit: (count: number, noun: string) =>
    `You've added ${count} ${noun}, the most for now. Remove one to add another.`,
} as const;

/** An upload refused for a reason the owner can fix; the message is the UI-SPEC copy. */
export class UploadRejected extends InvalidInput {
  override readonly code: string = "upload_rejected";
  readonly reason: UploadRejectReason;
  constructor(reason: UploadRejectReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export type ImageFormat = "jpeg" | "png" | "webp";

export type SizedImage = { data: Uint8Array; width: number; height: number };

export type ProcessedImage = {
  format: ImageFormat;
  /** Upright (auto-oriented) full-resolution size. */
  width: number;
  height: number;
  original: Uint8Array;
  web: SizedImage;
  thumb: SizedImage;
  /** LIBRARY_WIDTHS narrower than the upright width (never enlarged). */
  widths: Partial<Record<LibraryWidthVariant, SizedImage>>;
  /** RGBA, 4 bytes per pixel, long side <= 128, sRGB. */
  palettePixels: SizedImage;
};

const HEIC_BRANDS = new Set(["heic", "heix", "mif1", "hevc", "heim", "heis"]);

function ascii(buf: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...buf.subarray(from, to));
}

/** The format the bytes claim to be, from their magic numbers alone. */
export function sniffFormat(buf: Uint8Array): ImageFormat | "heic" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    ascii(buf, 1, 4) === "PNG" &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "png";
  if (
    buf.length >= 12 &&
    ascii(buf, 0, 4) === "RIFF" &&
    ascii(buf, 8, 12) === "WEBP"
  )
    return "webp";
  if (
    buf.length >= 12 &&
    ascii(buf, 4, 8) === "ftyp" &&
    HEIC_BRANDS.has(ascii(buf, 8, 12))
  )
    return "heic";
  return null;
}

function reject(
  reason: Exclude<UploadRejectReason, "too_big" | "limit">,
): never {
  throw new UploadRejected(reason, UPLOAD_COPY[reason]);
}

function isPixelLimitError(err: unknown): boolean {
  return err instanceof Error && /pixel limit/i.test(err.message);
}

const INPUT = {
  limitInputPixels: MAX_INPUT_PIXELS,
  failOn: "error",
  sequentialRead: true,
} as const;

async function toSized(pipeline: Sharp): Promise<SizedImage> {
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

/** <= 128 px sRGB RGBA raw pixels: the server input to extractPalette (Pattern 5). */
function paletteSample(pipeline: Sharp): Sharp {
  return pipeline
    .resize({
      width: PALETTE_SAMPLE_SIDE,
      height: PALETTE_SAMPLE_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw();
}

/** The library widths for an auto-oriented base of upright width `width`. */
async function widthsOf(
  base: Sharp,
  width: number,
): Promise<Partial<Record<LibraryWidthVariant, SizedImage>>> {
  const out: Partial<Record<LibraryWidthVariant, SizedImage>> = {};
  for (const n of LIBRARY_WIDTHS) {
    if (!(n < width)) continue;
    out[`w${n}` as LibraryWidthVariant] = await toSized(
      base
        .clone()
        .resize({ width: n, withoutEnlargement: true })
        .webp({ quality: 80 }),
    );
  }
  return out;
}

async function processNow(buf: Uint8Array): Promise<ProcessedImage> {
  const sharp = await lib();
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new UploadRejected("too_big", UPLOAD_COPY.tooBig(buf.length));
  }
  const sniffed = sniffFormat(buf);
  if (sniffed === "heic") reject("heic");
  if (sniffed === null) reject("type");

  let meta: Metadata;
  try {
    meta = await sharp(buf, INPUT).metadata();
  } catch (err) {
    if (isPixelLimitError(err)) reject("pixels");
    reject("type");
  }
  if (meta.format !== sniffed) reject("type");
  if (!(meta.width > 0 && meta.height > 0)) reject("type");
  if (meta.width * meta.height > MAX_INPUT_PIXELS) reject("pixels");

  const format: ImageFormat = sniffed;
  const base = sharp(buf, INPUT).autoOrient();
  try {
    const encoded =
      format === "png"
        ? base.clone().png({ compressionLevel: 9 })
        : format === "jpeg"
          ? base.clone().jpeg({ quality: 92, mozjpeg: true })
          : base.clone().webp({ quality: 92 });
    const original = await toSized(encoded);
    const web = await toSized(
      base
        .clone()
        .resize({
          width: WEB_MAX_SIDE,
          height: WEB_MAX_SIDE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 }),
    );
    const thumb = await toSized(
      base
        .clone()
        .resize({
          width: THUMB_MAX_SIDE,
          height: THUMB_MAX_SIDE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 75 }),
    );
    const widths = await widthsOf(base, original.width);
    const palettePixels = await toSized(paletteSample(base.clone()));
    return {
      format,
      width: original.width,
      height: original.height,
      original: original.data,
      web,
      thumb,
      widths,
      palettePixels,
    };
  } catch (err) {
    if (isPixelLimitError(err)) reject("pixels");
    // A header that parses but a body libvips cannot decode (truncated, corrupt).
    if (
      err instanceof Error &&
      /^(Input|Vips|VipsJpeg|VipsForeign)/i.test(err.message)
    )
      reject("type");
    throw err;
  }
}

/** Verify, orient, strip and resize one upload. Serialised through the image queue. */
export function processImage(buf: Uint8Array): Promise<ProcessedImage> {
  return imageQueue.run(() => processNow(buf));
}

/** The stored original's file extension and MIME type. */
export function originalFile(format: ImageFormat): {
  ext: "jpg" | "png" | "webp";
  mime: string;
} {
  if (format === "jpeg") return { ext: "jpg", mime: "image/jpeg" };
  if (format === "png") return { ext: "png", mime: "image/png" };
  return { ext: "webp", mime: "image/webp" };
}

/**
 * Palette pixels of an already stored image (the kept original), for recomputing the mood
 * board proposal after a reorder, remove or restore. Same sampling as processImage.
 */
export function palettePixelsOf(buf: Uint8Array): Promise<SizedImage> {
  return imageQueue.run(async () => {
    const sharp = await lib();
    return toSized(paletteSample(sharp(buf, INPUT).autoOrient()));
  });
}

/**
 * The library widths of an already stored original (publish-time backfill of P6 photos,
 * 07-12 choice 4). `width` is the row's upright width; same rule and encoding as processImage.
 */
export function deriveWidths(
  originalBytes: Uint8Array,
  width: number,
): Promise<Partial<Record<LibraryWidthVariant, SizedImage>>> {
  return imageQueue.run(async () => {
    const sharp = await lib();
    return widthsOf(sharp(originalBytes, INPUT).autoOrient(), width);
  });
}
