// The VideoTranscoder selector (07-13 choice 9; G11; T-07-13-11).
//   CDS_VIDEO_TRANSCODER unset or "ffmpeg" -> ffmpeg from the OS (CDS_FFMPEG_PATH /
//                                             CDS_FFPROBE_PATH, default from PATH)
//   CDS_VIDEO_TRANSCODER "fake"            -> the test/dev fake; refused when CDS_ENV=production
// Any other value throws: a typo must never silently skip compression.
import type { VideoTranscoder } from "../ports";
import { createFakeTranscoder } from "./fake";
import { createFfmpegTranscoder } from "./ffmpeg";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

const cache = new Map<string, VideoTranscoder>();

export function getVideoTranscoder(env: Env = process.env): VideoTranscoder {
  const raw = env.CDS_VIDEO_TRANSCODER;
  const value = raw === undefined || raw === "" ? "ffmpeg" : raw;
  if (value !== "ffmpeg" && value !== "fake") {
    throw new Error("CDS_VIDEO_TRANSCODER must be ffmpeg or fake");
  }
  if (value === "fake" && env.CDS_ENV === "production") {
    throw new Error("CDS_VIDEO_TRANSCODER=fake is refused in production");
  }
  const ffmpegPath = env.CDS_FFMPEG_PATH || "ffmpeg";
  const ffprobePath = env.CDS_FFPROBE_PATH || "ffprobe";
  const key = `${value}|${ffmpegPath}|${ffprobePath}`;
  let t = cache.get(key);
  if (!t) {
    t =
      value === "fake"
        ? createFakeTranscoder()
        : createFfmpegTranscoder({ ffmpegPath, ffprobePath });
    cache.set(key, t);
  }
  return t;
}

/** Tests only: forget cached transcoders. */
export function resetVideoTranscoderForTests(): void {
  cache.clear();
}
