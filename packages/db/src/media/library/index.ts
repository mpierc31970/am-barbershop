// @cds/db P7 area barrel: Media library data (owner 07-12).
// Named exports only; never export a PocketBase client, a context minter or an internal
// writer helper (invariant 1). Wired into src/index.ts with `export *` (07-02).
// Internal by design (imported by path): mp3Info, chunkUploadRoot (07-27 temp sweep), the
// lock runners in run.ts.
export {
  uploadLibraryImage,
  uploadLibraryAudio,
  AUDIO_MAX_BYTES,
  AUDIO_COPY,
  type LibraryAsset,
} from "./upload";
export { ALT_REQUIRED_COPY, altSuggestionFromName, cleanFileName } from "./alt";
export {
  startChunkedUpload,
  appendChunk,
  finishChunkedUpload,
  abortChunkedUpload,
  CHUNK_PART_BYTES,
  CHUNK_LIMITS,
  type ChunkPurpose,
  type FinishedUpload,
} from "./chunks";
export {
  listLibrary,
  getLibraryItem,
  listMediaNeedingDescription,
  countMediaNeedingDescription,
  describeMedia,
  LIBRARY_PAGE_SIZE,
  IMAGE_ROW_KINDS,
  type LibraryItem,
  type LibraryPage,
  type LibraryFilter,
  type LibraryCounts,
  type DescribeItem,
} from "./list";
export { getMediaDelivery } from "./delivery";
export {
  readPublicMedia,
  resolvePublicMedia,
  resolveHubMedia,
  MAX_MEDIA_PER_PAGE,
  type ResolvedMediaData,
  type PublicMediaRow,
} from "./resolve";
export {
  openHubMediaObject,
  HUB_MEDIA_VARIANTS,
  isHubMediaVariant,
  type HubMediaObject,
  type HubMediaVariant,
} from "./hub-read";
export { imageWidthCandidates, type WidthCandidate } from "./srcset";
export {
  deleteMediaAsset,
  mediaUsedOn,
  type DeleteMediaDeps,
  type MediaUsedOn,
} from "./delete";
export {
  captureLinkCover,
  LINK_COVER_HOSTS,
  LINK_COVER_MAX_BYTES,
  type LinkCoverResult,
} from "./link-cover";
