"use client";
// MediaTile: one file in the media grid or the picker (07-17; CONT-14, CONT-18, CONT-21,
// D-UI-P7-5/7; 07-UI-SPEC "Grid", "Upload states", "Accessibility contract"; T-07-17-04).
//   Library tile: an <li> holding one <button> named "IMG_2041.jpg, photo, needs description"
//     (opens the drawer); square thumb (photo / video poster + Play + length / AudioLines),
//     name, tabular meta, badges, and the video state lines with Try again / Remove.
//   Picker tile (`selectable`): the <li> is the listbox option itself (aria-selected, the 2px
//     accent ring + Check corner); MediaGrid moves focus with the arrow keys.
//   Upload tile (`upload`): local preview or kind icon, determinate accent bar + "Uploading…
//     42%" + Stop; "Making web-ready copies…"; or the error alert + Remove.
// File names and descriptions are rendered as text only (no innerHTML anywhere).
import { AudioLines, Check, Film, Images, Play, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { InlineAlert } from "./feedback";
import {
  MEDIA_COPY,
  formatDuration,
  tileMeta,
  tileName,
  videoBadge,
  type LibraryItemView,
  type MediaKind,
} from "./media/copy";
import type { UploadTileView } from "./useMediaUploads";

export interface MediaTileProps {
  item?: LibraryItemView;
  upload?: UploadTileView;
  /** Picker mode: the tile is a listbox option. */
  selectable?: boolean;
  selected?: boolean;
  /** Roving tabindex for picker options. */
  tabIndex?: number;
  canWrite?: boolean;
  onOpen?(id: string): void;
  onRetry?(id: string): void;
  onRemove?(id: string): void;
  onStop?(key: string): void;
  onToggle?(id: string): void;
  onOptionKeyDown?(e: KeyboardEvent<HTMLLIElement>, id: string): void;
}

const KIND_ICON: Record<MediaKind, typeof Images> = {
  image: Images,
  video: Film,
  audio: AudioLines,
};

function Indeterminate({ label }: { label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className="h-1 w-full overflow-hidden rounded-full bg-hub-surface-2"
    >
      <div className="h-full w-1/3 animate-pulse bg-hub-accent motion-reduce:animate-none" />
    </div>
  );
}

function Thumb({ item }: { item: LibraryItemView }) {
  const frame =
    "relative aspect-square w-full overflow-hidden rounded bg-hub-surface-2";
  if (item.kind === "audio") {
    return (
      <div
        className={`${frame} flex items-center justify-center text-hub-ink-muted`}
      >
        <AudioLines aria-hidden size={20} strokeWidth={2} />
      </div>
    );
  }
  const src = item.kind === "video" ? item.posterUrl : item.thumbUrl;
  const ready =
    item.kind !== "video" || item.videoState === "ready" || !item.videoState;
  return (
    <div className={frame}>
      {src && ready ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-hub-ink-muted">
          <Film aria-hidden size={20} strokeWidth={2} />
        </div>
      )}
      {item.kind === "video" ? (
        <span className="absolute bottom-2 left-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-hub-ink/70 text-hub-surface">
            <Play aria-hidden size={20} strokeWidth={2} />
          </span>
          {item.durationS > 0 ? (
            <span className="rounded bg-hub-ink/70 px-1 text-sm text-hub-surface tabular-nums">
              {formatDuration(item.durationS)}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function Caption({ item }: { item: LibraryItemView }) {
  return (
    <>
      <span className="block truncate text-sm text-hub-ink" title={item.name}>
        {item.name}
      </span>
      <span className="block text-sm text-hub-ink-muted tabular-nums">
        {tileMeta(item)}
      </span>
    </>
  );
}

function Badges({ item }: { item: LibraryItemView }) {
  const vb = item.kind === "video" ? videoBadge(item.videoState) : null;
  if (!item.needsDescription && !vb) return null;
  return (
    <span className="flex flex-wrap gap-2">
      {item.needsDescription ? (
        <Badge tone="needs-description">Needs description</Badge>
      ) : null}
      {vb ? <Badge tone={vb.tone}>{vb.label}</Badge> : null}
    </span>
  );
}

function VideoState({
  item,
  canWrite,
  onRetry,
  onRemove,
}: {
  item: LibraryItemView;
  canWrite: boolean;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
}): ReactNode {
  switch (item.videoState) {
    case "optimizing":
      return (
        <div className="flex flex-col gap-2">
          <Indeterminate label={`Optimizing ${item.name}`} />
          <p className="text-sm text-hub-ink-muted">
            {MEDIA_COPY.videoProcessing}
          </p>
        </div>
      );
    case "waiting":
      return (
        <p className="text-sm text-hub-ink-muted">{MEDIA_COPY.videoWaiting}</p>
      );
    case "failed":
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-hub-danger">{MEDIA_COPY.videoFailed}</p>
          {canWrite && onRetry ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRetry(item.id)}
            >
              Try again
            </Button>
          ) : null}
        </div>
      );
    case "failed-final":
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-hub-danger">
            {MEDIA_COPY.videoFailedFinal}
          </p>
          {canWrite && onRemove ? (
            <Button variant="ghost" size="sm" onClick={() => onRemove(item.id)}>
              Remove
            </Button>
          ) : null}
        </div>
      );
    default:
      return null;
  }
}

function UploadTile({
  upload,
  onStop,
  onRemove,
}: {
  upload: UploadTileView;
  onStop?: (key: string) => void;
  onRemove?: (key: string) => void;
}) {
  const Icon = upload.kind ? KIND_ICON[upload.kind] : Images;
  return (
    <li
      data-upload-tile={upload.status}
      className="flex min-w-0 flex-col gap-2 font-hub"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded bg-hub-surface-2">
        {upload.preview ? (
          <img
            src={upload.preview}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-hub-ink-muted">
            <Icon aria-hidden size={20} strokeWidth={2} />
          </div>
        )}
      </div>
      <span className="block truncate text-sm text-hub-ink" title={upload.name}>
        {upload.name}
      </span>
      {upload.status === "error" ? (
        <div className="flex flex-col items-start gap-2">
          <InlineAlert tone="error">
            {upload.message ?? MEDIA_COPY.failed}
          </InlineAlert>
          {onRemove ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(upload.key)}
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : upload.status === "processing" ? (
        <div className="flex flex-col gap-2">
          <Indeterminate label={`Processing ${upload.name}`} />
          <p className="text-sm text-hub-ink-muted">{MEDIA_COPY.processing}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label={`Uploading ${upload.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={upload.pct}
            className="h-1 w-full overflow-hidden rounded-full bg-hub-surface-2"
          >
            <div
              className="h-full bg-hub-accent transition-[width] duration-150 motion-reduce:transition-none"
              style={{ width: `${upload.pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-hub-ink-muted tabular-nums">
              {upload.status === "queued"
                ? "Waiting to upload"
                : `Uploading… ${upload.pct}%`}
            </span>
            {onStop ? (
              <IconButton
                size="sm"
                label={`Stop uploading ${upload.name}`}
                tooltipAlign="end"
                onClick={() => onStop(upload.key)}
                icon={<X aria-hidden size={16} strokeWidth={2} />}
              />
            ) : null}
          </div>
          {upload.kind === "video" ? (
            <p className="text-sm text-hub-ink-muted">{MEDIA_COPY.keepOpen}</p>
          ) : null}
        </div>
      )}
    </li>
  );
}

export function MediaTile({
  item,
  upload,
  selectable = false,
  selected = false,
  tabIndex,
  canWrite = false,
  onOpen,
  onRetry,
  onRemove,
  onStop,
  onToggle,
  onOptionKeyDown,
}: MediaTileProps) {
  if (upload) {
    return <UploadTile upload={upload} onStop={onStop} onRemove={onRemove} />;
  }
  if (!item) return null;

  if (selectable) {
    return (
      <li
        role="option"
        aria-selected={selected}
        aria-label={tileName(item)}
        tabIndex={tabIndex ?? -1}
        data-media-option={item.id}
        onClick={() => onToggle?.(item.id)}
        onKeyDown={(e) => onOptionKeyDown?.(e, item.id)}
        className={
          "relative flex min-w-0 cursor-pointer flex-col gap-2 rounded p-1 font-hub " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent " +
          (selected ? "ring-2 ring-hub-accent" : "")
        }
      >
        <Thumb item={item} />
        {selected ? (
          <span
            aria-hidden
            className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-hub-accent text-hub-surface"
          >
            <Check size={16} strokeWidth={2} />
          </span>
        ) : null}
        <Caption item={item} />
        <Badges item={item} />
      </li>
    );
  }

  return (
    <li
      data-media-tile={item.id}
      className="flex min-w-0 flex-col gap-2 font-hub"
    >
      <button
        type="button"
        aria-label={tileName(item)}
        onClick={() => onOpen?.(item.id)}
        className={
          "flex min-w-0 flex-col gap-2 rounded text-left " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
        }
      >
        <Thumb item={item} />
        <Caption item={item} />
      </button>
      <Badges item={item} />
      {item.kind === "video" ? (
        <VideoState
          item={item}
          canWrite={canWrite}
          onRetry={onRetry}
          onRemove={onRemove}
        />
      ) : null}
    </li>
  );
}
