// @cds/ui/hub P7 media (owner 07-17; 07-02 seam).
// Hub area barrel. Hub primitives read only --hub-* tokens and never touch the database
// client or the sanitizer (invariant 1).
// hub/index.ts `export *`s every p7 barrel, so generic helper names carry a media prefix here
// (duplicates break tsc).
export { UsageMeter, type UsageMeterProps } from "../UsageMeter";
export { MediaTile, type MediaTileProps } from "../MediaTile";
export { MediaGrid, type MediaGridProps } from "../MediaGrid";
export {
  MediaFilters,
  SEARCH_DEBOUNCE_MS as MEDIA_SEARCH_DEBOUNCE_MS,
  type MediaFilterPatch,
  type MediaFiltersProps,
} from "../MediaFilters";
export {
  MediaDropZone,
  MediaUploadButton,
  type MediaDropZoneProps,
  type MediaUploadButtonProps,
} from "../MediaDropZone";
export {
  useMediaUploads,
  defaultMediaUploader,
  type MediaUploader,
  type MediaUploads,
  type UploadBatchSummary,
  type UploadTileView,
  type UseMediaUploadsOptions,
} from "../useMediaUploads";
export {
  MediaDetailDrawer,
  mediaIsUsed,
  type MediaDetailDrawerProps,
} from "../MediaDetailDrawer";
export { DescribeList, type DescribeListProps } from "../DescribeList";
export { MediaPicker, type MediaPickerProps } from "../MediaPicker";
export {
  MEDIA_ACCEPT,
  MEDIA_COPY,
  MEDIA_LIMITS,
  MEDIA_PAGE_SIZE,
  POLL_MS as MEDIA_POLL_MS,
  deleteLabel as mediaDeleteLabel,
  deleteTitle as mediaDeleteTitle,
  deletedToast as mediaDeletedToast,
  describeNotice as mediaDescribeNotice,
  filterLabel as mediaFilterLabel,
  formatDuration as mediaFormatDuration,
  isPolling as isVideoPolling,
  keepLabel as mediaKeepLabel,
  kindFilter as mediaKindFilter,
  kindNoun as mediaKindNoun,
  leftCount as describeLeftCount,
  pickedOf as mediaPickedOf,
  pickerEmpty as mediaPickerEmpty,
  pickerTitle as mediaPickerTitle,
  pickerUseLabel as mediaPickerUseLabel,
  readyToast as videoReadyToast,
  selectedCount as mediaSelectedCount,
  tileMeta as mediaTileMeta,
  tileName as mediaTileName,
  tileSize as mediaTileSize,
  uploadedToast as mediaUploadedToast,
  videoBadge as mediaVideoBadge,
  videoTooBigCopy as mediaVideoTooBigCopy,
  type DescribeRowView,
  type LibraryCountsView,
  type LibraryFilterView,
  type LibraryItemView,
  type LibraryPageView,
  type MediaKind,
  type PickedMedia,
  type UsageView as MediaUsageView,
  type UsedOnView as MediaUsedOnView,
  type VideoBadge as MediaVideoBadge,
  type VideoStateView,
} from "../media/copy";
export {
  checkMediaFile,
  uploadImageFile,
  uploadChunkedFile,
  failureMessage as mediaUploadFailureMessage,
  CHUNK_URLS as MEDIA_CHUNK_URLS,
  MEDIA_UPLOAD_URL,
  MAX_PART_BYTES as MEDIA_MAX_PART_BYTES,
  type MediaCheck,
  type UploadOptions as MediaUploadOptions,
  type UploadResult as MediaUploadResult,
} from "../media/upload";
export {
  fetchMediaSource,
  MEDIA_LIBRARY_URL,
  type MediaListOptions,
  type MediaListResult,
  type MediaSource,
} from "../media/source";
export {
  sendXhr,
  startXhr,
  AbortError as UploadAbortError,
  NetworkError as UploadNetworkError,
  type XhrOptions,
  type XhrOutcome,
  type XhrResult,
} from "../media/xhr";
