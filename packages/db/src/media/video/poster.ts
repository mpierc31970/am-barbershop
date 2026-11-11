// Video posters (07-13 choice 8; T-07-13-05). The frame ffmpeg took from the transcoded output
// (already rotated and scaled) is re-encoded by sharp into poster.jpg (q82), poster.webp (q80)
// and the 400 px thumb (WebP q80). sharp drops metadata by default: never call withMetadata.
// Runs through imageQueue, so this short sharp work stays serialised with image decodes.
import { imageQueue } from "../queue";
import { THUMB_MAX_SIDE } from "../pipeline";

type SharpFn = typeof import("sharp").default;
let loaded: Promise<SharpFn> | null = null;

function lib(): Promise<SharpFn> {
  loaded ??= import("sharp").then((m) => {
    m.default.concurrency(1);
    return m.default;
  });
  return loaded;
}

export type VideoPosters = {
  jpg: Uint8Array;
  webp: Uint8Array;
  thumb: Uint8Array;
  width: number;
  height: number;
};

export function makeVideoPosters(frame: Uint8Array): Promise<VideoPosters> {
  return imageQueue.run(async () => {
    const sharp = await lib();
    const base = () => sharp(frame, { failOn: "error" }).rotate();
    const [jpg, webp, thumb] = await Promise.all([
      base().jpeg({ quality: 82, mozjpeg: true }).toBuffer({
        resolveWithObject: true,
      }),
      base().webp({ quality: 80 }).toBuffer(),
      base()
        .resize({
          width: THUMB_MAX_SIDE,
          height: THUMB_MAX_SIDE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer(),
    ]);
    return {
      jpg: new Uint8Array(jpg.data),
      webp: new Uint8Array(webp),
      thumb: new Uint8Array(thumb),
      width: jpg.info.width,
      height: jpg.info.height,
    };
  });
}
