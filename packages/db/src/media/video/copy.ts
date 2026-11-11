// Video copy (07-13; 07-UI-SPEC copy table rows VIDEO-*, UPL-VIDEO-TYPE, UPL-CAPTIONS and the
// "Waiting to optimize" upload state). Exact strings: never re-type them elsewhere. The too-big
// copy stays in 07-12's CHUNK_LIMITS.video.tooBig.
import { CHUNK_LIMITS } from "../library/chunks";

export const VIDEO_COPY = Object.freeze({
  processing:
    "We're optimizing your video for fast playback. This takes a minute or two.",
  failed:
    "We couldn't optimize this video. Try again, or export it again as MP4.",
  failedFinal:
    "We couldn't optimize this video. Try exporting it again as MP4.",
  type: "This isn't an MP4 video. Export it as MP4 and try again.",
  captions:
    "This isn't a captions file we can use. Upload a .vtt file under 512 KB.",
  waiting: "Another video is being optimized first.",
});

export const VIDEO_MAX_BYTES: number = CHUNK_LIMITS.video.maxBytes;
