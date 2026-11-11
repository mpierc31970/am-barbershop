// Media chokepoint barrel (ONB-04, ONB-05; 06-13). pipeline.ts and queue.ts internals stay
// here: callers upload and read through assets.ts only.
export {
  uploadImage,
  readMediaVariant,
  listMedia,
  setMediaAlt,
  removeMedia,
  restoreMedia,
  reorderMedia,
  isMediaKind,
  isMediaVariant,
  MEDIA_KINDS,
  MEDIA_VARIANTS,
  MEDIA_LIMITS,
  ALT_MAX,
  ALT_COPY,
} from "./assets";
export type { MediaAsset, MediaKind, MediaVariant } from "./assets";
export {
  UploadRejected,
  UPLOAD_COPY,
  MAX_UPLOAD_BYTES,
  MAX_INPUT_PIXELS,
} from "./pipeline";
export type { UploadRejectReason } from "./pipeline";
