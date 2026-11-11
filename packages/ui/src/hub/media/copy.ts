// Media library copy and view helpers (07-17; CONT-14, CONT-19, CONT-21, CONT-35, D280, D278;
// 07-UI-SPEC "Media", "Media picker", "Copywriting Contract"). Strings that also live in
// @cds/db are pinned by apps/web/test/media-copy-drift.test.ts (choice 2): @cds/ui never
// imports @cds/db, and the browser needs the copy before any request is sent.
// Pure: no React, no next/*, no @cds/db.
import {
  ALT_HELPER,
  ALT_MISSING_COPY,
  PROCESSING_COPY,
  UPL_COPY,
  formatBytes,
} from "./p6-copy";
import type { BadgeTone } from "../Badge";

export type MediaKind = "image" | "video" | "audio";
export type LibraryFilterView = "all" | "images" | "videos" | "audio";
export type VideoStateView =
  "waiting" | "optimizing" | "ready" | "failed" | "failed-final";

/** 07-12's LibraryItem (structurally equal) plus the polled video state. */
export type LibraryItemView = {
  id: string;
  kind: MediaKind;
  rowKind: string;
  name: string;
  alt: string;
  needsDescription: boolean;
  status: string;
  width: number;
  height: number;
  bytes: number;
  durationS: number;
  createdAt: string;
  thumbUrl: string | null;
  previewUrl: string;
  posterUrl: string | null;
  deleted?: boolean;
  /** A video whose cover is a library photo (07-13 setVideoCover). */
  customCover?: boolean;
  /** A video with a captions file. */
  hasCaptions?: boolean;
  videoState?: VideoStateView;
};

export type LibraryCountsView = {
  all: number;
  images: number;
  videos: number;
  audio: number;
};

export type LibraryPageView = {
  items: LibraryItemView[];
  total: number;
  page: number;
  perPage: number;
  counts: LibraryCountsView;
  needsDescription: number;
};

/** The meter's view; `label` and `message` are built on the server from @cds/db copy. */
export type UsageView = {
  usedBytes: number;
  allowanceBytes: number;
  ratio: number;
  level: "ok" | "warn" | "full";
  label: string;
  message: string;
  /**
   * 10-43 (BILL-13, D285): the viewer may buy a media pack on the saved card. Decided on the
   * server (Owner, not impersonating); absent means no purchase controls.
   */
  canBuy?: boolean;
  /** "Add storage" target (Settings › Billing #storage); absent or null means no link. */
  storageHref?: string | null;
  /** The at-limit pack buttons, primary first (labels from the server). Empty unless canBuy. */
  offers?: { size: "5gb" | "25gb"; label: string }[];
};

export type UsedOnView = {
  pages: { id: string; title: string }[];
  inVersions: boolean;
  inPopups: boolean;
  asCover?: boolean;
  intakeSlot?: boolean;
};

export type DescribeRowView = {
  id: string;
  name: string;
  thumbUrl: string;
  suggestion: string;
};

/** What a picker hands back to its field, in pick order. */
export type PickedMedia = {
  id: string;
  kind: MediaKind;
  name: string;
  alt: string;
  thumbUrl: string | null;
  width: number;
  height: number;
  needsDescription: boolean;
  deleted?: boolean;
  /**
   * 07-30: a Free photos pick (id ""). Stored by URL (never counted toward 2 GB) with its
   * credit; the photo id is only for the source's "photo used" ping.
   */
  stock?: PickedStock;
};

/** A stock photo as the picker shows it (mirrors @cds/db StockPhoto). */
export type StockPhotoView = {
  id: string;
  source: "unsplash" | "pexels";
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  alt: string;
  creditName: string;
  creditUrl: string;
};

export type StockPhotoPageView = {
  photos: readonly StockPhotoView[];
  hasMore: boolean;
};

export type PickedStock = {
  url: string;
  width: number;
  height: number;
  creditName: string;
  creditUrl: string;
  source: "unsplash" | "pexels";
  photoId: string;
};

/** "Photo by Ana Silva" (tile credit, Label ink-muted). */
export function photoByLabel(name: string): string {
  return `Photo by ${name}`;
}

/** A stock pick as the picker returns it. */
export function pickedOfStock(photo: StockPhotoView, alt: string): PickedMedia {
  return {
    id: "",
    kind: "image",
    name: photoByLabel(photo.creditName),
    alt,
    thumbUrl: photo.thumbUrl,
    width: photo.width,
    height: photo.height,
    needsDescription: false,
    stock: {
      url: photo.url,
      width: photo.width,
      height: photo.height,
      creditName: photo.creditName,
      creditUrl: photo.creditUrl,
      source: photo.source,
      photoId: photo.id,
    },
  };
}

const MiB = 1024 * 1024;

/** Mirrors @cds/db; the server stays the authority. */
export const MEDIA_LIMITS = Object.freeze({
  image: 20 * MiB,
  video: 250 * MiB,
  audio: 50 * MiB,
  captions: 512 * 1024,
});

/**
 * The library's file input. HEIC/HEIF are left out on purpose (P6 PD-6): without them iOS
 * converts an iPhone photo to JPEG on pick; the server refuses raw HEIC anyway.
 */
export const MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,audio/mpeg";

/** Grid page size (07-UI-SPEC "60 per page"; choice 4). */
export const MEDIA_PAGE_SIZE = 60;
/** Video state polling (D-UI-P7-8). */
export const POLL_MS = 10_000;

const DRAWER_ALT_HELPER = `${ALT_HELPER.replace(/\.$/, "")} (also called alt text).`;

export const MEDIA_COPY = Object.freeze({
  title: "Media",
  helpLabel: "How Media works",
  uploadFiles: "Upload files",
  chooseFiles: "Choose files",
  emptyHeading: "No media yet",
  emptyBody:
    "Upload photos, videos and audio once, then use them on any page. Drop files here or choose them.",
  filteredEmpty: "Nothing matches. Clear the search to see everything.",
  clearFilters: "Clear filters",
  loadMore: "Load more",
  searchLabel: "Search by name or description",
  filterLabel: "Show",
  /**
   * Fallback only (10-33): the full-state line is the server's `usage.message` (USAGE-FULL-PACKS
   * for the org's own allowance). Mirrors @cds/db USAGE_COPY.member; 10-43 adds the pack offer.
   */
  /** 10-43: link to Settings › Billing › Media storage (never a purchase inside a picker). */
  addStorage: "Add storage",
  usageFull:
    "Media storage is full. Ask your site owner to add more, or delete something to make room.",
  videoProcessing:
    "We're optimizing your video for fast playback. This takes a minute or two.",
  videoFailed:
    "We couldn't optimize this video. Try again, or export it again as MP4.",
  videoFailedFinal:
    "We couldn't optimize this video. Try exporting it again as MP4.",
  videoWaiting: "Another video is being optimized first.",
  videoType: "This isn't an MP4 video. Export it as MP4 and try again.",
  audio:
    "This isn't an MP3 file, or it's over 50 MB. Export an MP3 under 50 MB and try again.",
  captions:
    "This isn't a captions file we can use. Upload a .vtt file under 512 KB.",
  failed: UPL_COPY.failed,
  imageType: UPL_COPY.type,
  heic: UPL_COPY.heic,
  moveToYouTube:
    "This video is watched a lot, which uses much of your site's delivery allowance. Upload it to YouTube and paste the link here instead.",
  keepOpen: "Keep this page open until the upload finishes.",
  processing: PROCESSING_COPY,
  describeHeading: "Describe your photos",
  describeUse: "Use this",
  describeDoneHeading: "Every photo has a description",
  describeDoneBody:
    "Thanks. People using screen readers can now hear what your photos show.",
  describeThem: "Describe them",
  backToAll: "Back to all media",
  allMedia: "← All media",
  notSaved: "Not saved. Try again",
  altMissing: ALT_MISSING_COPY,
  altHelper: DRAWER_ALT_HELPER,
  descriptionLabel: "Description",
  saveDescription: "Save description",
  captionsLabel: "Captions file (.vtt)",
  captionsHelper:
    "Captions help people who watch without sound. Most video editors can export a .vtt file.",
  coverLabel: "Cover",
  chooseCover: "Choose a different cover",
  generatedCover: "Use the generated cover",
  notUsed: "Not used on any page",
  deletedLabel: "Deleted from your media. Pages that use it keep showing it.",
  deletedField: "Deleted from your media",
  gone: "This was removed or moved. Reload the page to see the latest.",
  errLoad: "We couldn't load this. Check your connection and try again.",
  signedOut: "Your session has ended. Sign in again to keep going.",
  deleteUsedBody:
    "It leaves your media. Pages that use it now, and older versions you might restore, keep showing it until you change them.",
  deleteUnusedBody: "It's deleted for good and stops loading anywhere.",
  // Toasts (choice 7; UI-SPEC has no exact strings for these).
  descriptionSaved: "Description saved.",
  optimizingAgain: "Optimizing again.",
  captionsSaved: "Captions saved.",
  captionsRemoved: "Captions removed.",
  coverSaved: "Cover saved.",
  yourMedia: "Your media",
  upload: "Upload",
  // 07-30 Free photos tab (UI-SPEC "Media picker"; D-UI-P7-11: absent without stock keys).
  freePhotos: "Free photos",
  stockSearchLabel: "Search free photos, like 'bakery'",
  stockHint:
    "Free to use. The photographer is credited under the photo on your site.",
  stockEmpty: "No free photos match. Try another word.",
});

/** UPL-VIDEO-TOO-BIG (same rounding as @cds/db CHUNK_LIMITS.video.tooBig). */
export function videoTooBigCopy(bytes: number): string {
  return `This video is ${Math.max(251, Math.ceil(bytes / MiB))} MB. The limit is 250 MB: export a shorter or smaller copy, or upload it to YouTube and paste the link.`;
}

const NOUN: Record<MediaKind, string> = {
  image: "photo",
  video: "video",
  audio: "audio",
};

export function kindNoun(kind: MediaKind): string {
  return NOUN[kind];
}

/** "12 photos need a description" / "1 photo needs a description". */
export function describeNotice(n: number): string {
  return n === 1
    ? "1 photo needs a description"
    : `${n} photos need a description`;
}

export function leftCount(n: number): string {
  return `${Math.max(0, n)} left`;
}

/** The batch toast (07-UI-SPEC "After a multi-file upload"). */
export function uploadedToast(n: number): string {
  return `${n} ${n === 1 ? "photo" : "photos"} uploaded. Add their descriptions so everyone can see them.`;
}

export function readyToast(name: string): string {
  return `${name} is ready.`;
}

export function deletedToast(kind: MediaKind): string {
  return kind === "image"
    ? "Photo deleted."
    : kind === "video"
      ? "Video deleted."
      : "Audio deleted.";
}

export function deleteTitle(name: string): string {
  return `Delete ${name}?`;
}

export function deleteLabel(kind: MediaKind): string {
  return `Delete ${NOUN[kind]}`;
}

export function keepLabel(kind: MediaKind): string {
  return `Keep ${NOUN[kind]}`;
}

export function pickerTitle(kind: MediaKind, multiple = false): string {
  if (kind === "image") return multiple ? "Choose photos" : "Choose a photo";
  if (kind === "video") return multiple ? "Choose videos" : "Choose a video";
  return "Choose audio";
}

/** The picker's primary: "Use this photo" / "Use 3 photos" / "Use this video". */
export function pickerUseLabel(kind: MediaKind, n: number): string {
  if (n > 1) {
    return kind === "image"
      ? `Use ${n} photos`
      : kind === "video"
        ? `Use ${n} videos`
        : `Use ${n} audio files`;
  }
  return `Use this ${NOUN[kind]}`;
}

export function pickerEmpty(kind: MediaKind): string {
  if (kind === "video") {
    return "No videos yet. Upload an MP4 here, or paste a YouTube link in the video settings instead.";
  }
  if (kind === "audio") return "No audio yet. Upload an MP3 here.";
  return "No photos yet. Upload one here.";
}

export function selectedCount(n: number): string {
  return `${n} selected`;
}

export function filterLabel(f: LibraryFilterView): string {
  return f === "all"
    ? "All"
    : f === "images"
      ? "Images"
      : f === "videos"
        ? "Videos"
        : "Audio";
}

export function kindFilter(kind: MediaKind): LibraryFilterView {
  return kind === "image" ? "images" : kind === "video" ? "videos" : "audio";
}

/** "0:42" / "3:12" / "1:02:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Tile meta (tabular): "2560 × 1707 · 1.8 MB" / "0:42 · 18 MB" / "3:12 · 4.4 MB". */
export function tileMeta(
  item: Pick<
    LibraryItemView,
    "kind" | "width" | "height" | "bytes" | "durationS"
  >,
): string {
  const size = formatBytes(item.bytes);
  if (item.kind === "image") {
    return item.width > 0 && item.height > 0
      ? `${item.width} × ${item.height} · ${size}`
      : size;
  }
  return item.durationS > 0
    ? `${formatDuration(item.durationS)} · ${size}`
    : size;
}

/** The size in the drawer: formatBytes, but "18 MB" rather than "18.0 MB". */
export function tileSize(bytes: number): string {
  return formatBytes(bytes).replace(/\.0 MB$/, " MB");
}

export type VideoBadge = { label: string; tone: BadgeTone };

export function videoBadge(
  state: VideoStateView | undefined,
): VideoBadge | null {
  switch (state) {
    case "waiting":
      return { label: "Waiting to optimize", tone: "waiting-optimize" };
    case "optimizing":
      return { label: "Optimizing", tone: "optimizing" };
    case "failed":
    case "failed-final":
      return { label: "Couldn't optimize", tone: "failed" };
    default:
      return null;
  }
}

const STATE_WORDS: Record<VideoStateView, string> = {
  waiting: "waiting to optimize",
  optimizing: "optimizing",
  ready: "",
  failed: "couldn't optimize",
  "failed-final": "couldn't optimize",
};

/** The tile button's accessible name: "IMG_2041.jpg, photo, needs description". */
export function tileName(
  item: Pick<
    LibraryItemView,
    "name" | "kind" | "needsDescription" | "videoState"
  >,
): string {
  const parts = [item.name || NOUN[item.kind], NOUN[item.kind]];
  if (item.kind === "image" && item.needsDescription) {
    parts.push("needs description");
  }
  if (item.kind === "video" && item.videoState) {
    const w = STATE_WORDS[item.videoState];
    if (w) parts.push(w);
  }
  return parts.join(", ");
}

/** True while any video is waiting or optimizing (D-UI-P7-8: poll only then). */
export function isPolling(
  states: Readonly<Record<string, VideoStateView>> | readonly VideoStateView[],
): boolean {
  const list = Array.isArray(states)
    ? (states as readonly VideoStateView[])
    : Object.values(states as Record<string, VideoStateView>);
  return list.some((s) => s === "waiting" || s === "optimizing");
}

/** A library item as the picker hands it back. */
export function pickedOf(item: LibraryItemView): PickedMedia {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    alt: item.alt,
    thumbUrl: item.thumbUrl,
    width: item.width,
    height: item.height,
    needsDescription: item.needsDescription,
    ...(item.deleted ? { deleted: true } : {}),
  };
}
