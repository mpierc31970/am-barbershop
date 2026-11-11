// @cds/db P7 area barrel: Video pipeline (owner 07-13).
// Named exports only; never export a PocketBase client, a context minter or an internal
// writer helper (invariant 1). Wired into src/index.ts with `export *` (07-02).
// Internal by design (imported by path): the fake transcoder, the job runner, the test
// queue drain, the work-dir helpers (07-27 temp sweep) and the ffmpeg argument builders.
export { createVideoFromUpload, type VideoAsset } from "./upload";
export {
  retryVideo,
  setVideoCover,
  videoStates,
  VIDEO_STATES_MAX,
} from "./manage";
export { uploadVideoCaptions, removeVideoCaptions } from "./captions";
export {
  sweepStuckVideos,
  resumeVideoJobs,
  type VideoSweepResult,
} from "./sweep";
export { getVideoTranscoder } from "./transcoder";
export { VIDEO_COPY, VIDEO_MAX_BYTES } from "./copy";
export { VTT_MAX_BYTES } from "./vtt";
export { TranscoderUnavailable } from "./ffmpeg";
export type { VideoJobState } from "./job";
