"use client";
// ImageUpload: the one photo field for logo, hero, gallery, team photo and mood board
// (06-19; 06-UI-SPEC "Upload field", "Copywriting Contract" UPL-* / LOW-RES / Alt missing,
// "Accessibility contract"; ONB-04, D280, D-UI-P6-21, D-UI-P6-27, D-UI-P6-30, D-UI-P6-31).
//
//   Empty       drop zone (same look as P5 FileDrop) + a real, labelled file input
//   Checking    instant client check of type and size; a failure never sends a request
//   Uploading   local preview + determinate bar (XHR upload.onprogress) + Stop upload
//   Processing  "Making web-ready copies…" while the server resizes (06-13 pipeline)
//   Done        the server's 400px thumbnail, "2560 × 1707 · 1.8 MB", Photo description
//               (prefilled with suggestedAlt), Replace and Remove (Undo toast, 8s)
//   Logo done   the logo on #FFFFFF and on #1B1B19 side by side (no checkerboard)
//   Low-res     a warning, never a block (hero < 1600px, logo < 400px)
//   Gallery     a grid in order, dnd-kit keyboard sensor + Move earlier / Move later, the
//               drop zone after the last until the limit (UPL-LIMIT)
//
// PD-6 (RESEARCH Pitfall 6, a deliberate deviation from the UI-SPEC list): the accept list is
// JPEG, PNG and WebP only. Leaving the HEIC/HEIF types out makes iOS convert an iPhone
// photo to JPEG on pick. The server still refuses raw HEIC with UPL-HEIC.
// Client checks are UX only (T-06-91): the server re-verifies bytes, size and pixels.
// Thumbnails load from the authenticated /hub/media route only (T-06-94).
// @cds/ui never imports @cds/db (invariant 1), so the UPL copy is repeated here; a test in
// apps/web checks it against the server's UPLOAD_COPY.
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, ArrowRight, GripVertical, ImagePlus } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { InlineAlert } from "./feedback";
import { TextField } from "./fields";
import { useToast } from "./Toast";
import { NetworkError, startXhr } from "./media/xhr";
import {
  ACCEPT,
  ALT_HELPER,
  ALT_MISSING_COPY,
  ALT_SAVE_FAILED_COPY,
  MAX_UPLOAD_BYTES,
  PHOTO_REMOVED_COPY,
  PROCESSING_COPY,
  UPL_COPY,
  formatBytes,
} from "./media/p6-copy";

export type MediaUploadKind =
  "logo" | "hero" | "gallery" | "team" | "moodboard";

/** What the field shows for one saved photo (built from the server's MediaAsset). */
export type MediaAssetView = {
  id: string;
  kind: string;
  width: number;
  height: number;
  webWidth: number;
  bytes: number;
  alt: string;
  thumbUrl: string;
  filename?: string;
};

export interface ImageUploadProps {
  kind: MediaUploadKind;
  label: string;
  helper: string;
  value: MediaAssetView[];
  /** Base id; the drop zone's file input gets `${id}-input`. Default: generated. */
  id?: string;
  labelExtra?: ReactNode;
  multiple?: boolean;
  max?: number;
  suggestedAlt?: string;
  altRequired?: boolean;
  onUploaded(asset: MediaAssetView, proposal?: unknown): void;
  /**
   * Save a photo description. Return the save's outcome (true = stored) so a failed save is
   * retried on the next blur and flagged on the field (B-WR-07); a void return is treated
   * as handled elsewhere (an autosave scope with its own Retry).
   */
  onAltChange(id: string, alt: string): void | Promise<boolean>;
  onRemove(id: string): void;
  /** Undo of a remove (the Toast's Undo). */
  onRestore?(id: string): void;
  onReorder?(ids: string[]): void;
  /** Mood board: called with the picked file before upload (client palette). */
  onPick?(file: File): void;
  /** Multiple: a Label on the first tile (mood board: "Colours come from this one"). */
  firstLabel?: string;
  readOnly?: boolean;
  /** Upload endpoint. Default /hub/api/media. */
  endpoint?: string;
}

// The P6 upload copy and size rules live in a plain module (07-17) so server-safe modules
// (hub/media/*) can read the strings: values exported from this "use client" file are client
// references on the server. Re-exported here unchanged.
export {
  ACCEPT,
  ALT_HELPER,
  ALT_MISSING_COPY,
  ALT_SAVE_FAILED_COPY,
  MAX_UPLOAD_BYTES,
  PHOTO_REMOVED_COPY,
  PROCESSING_COPY,
  UPL_COPY,
  formatBytes,
};
const ACCEPTED: ReadonlySet<string> = new Set(ACCEPT.split(","));

const LIMIT_NOUN: Record<MediaUploadKind, string> = {
  gallery: "photos",
  moodboard: "mood boards",
  team: "team photos",
  logo: "logos",
  hero: "photos",
};

export function limitCopy(kind: MediaUploadKind, max: number): string {
  return `You've added ${max} ${LIMIT_NOUN[kind]}, the most for now. Remove one to add another.`;
}

/** LOW-RES (D-UI-P6-30): hero under 1600px wide, logo under 400px. Other kinds: none. */
export function lowResCopy(kind: string, webWidth: number): string | null {
  const min = kind === "hero" ? 1600 : kind === "logo" ? 400 : 0;
  if (min === 0 || webWidth <= 0 || webWidth >= min) return null;
  const noun = kind === "logo" ? "logo" : "photo";
  return `This ${noun} is ${webWidth.toLocaleString("en-US")} px wide, so it may look soft on a large screen. A ${noun} at least ${min.toLocaleString("en-US")} px wide looks best.`;
}

/** "2560 × 1707 · 1.8 MB". */
export function mediaMeta(
  a: Pick<MediaAssetView, "width" | "height" | "bytes">,
) {
  return `${a.width} × ${a.height} · ${formatBytes(a.bytes)}`;
}

/** The client check before any request: null when the file may be sent. */
export function checkFile(
  file: Pick<File, "type" | "size" | "name">,
): string | null {
  const type = (file.type || "").toLowerCase();
  if (!ACCEPTED.has(type)) {
    if (/^image\/hei[cf]$/.test(type) || /\.hei[cf]$/i.test(file.name)) {
      return UPL_COPY.heic;
    }
    return UPL_COPY.type;
  }
  if (file.size > MAX_UPLOAD_BYTES) return UPL_COPY.tooBig(file.size);
  return null;
}

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The upload route's asset JSON -> the view (thumbUrl from its private url). */
export function mediaViewFromServer(
  raw: unknown,
  filename?: string,
): MediaAssetView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const id = str(a.id);
  if (!/^[a-z0-9]{1,32}$/i.test(id)) return null;
  const thumbUrl = str(a.thumbUrl) || str(a.url) || `/hub/media/${id}/thumb`;
  return {
    id,
    kind: str(a.kind),
    width: num(a.width),
    height: num(a.height),
    webWidth: num(a.webWidth),
    bytes: num(a.bytes),
    alt: str(a.alt),
    // Only the hub's own media route is ever used as an image source.
    thumbUrl: thumbUrl.startsWith("/hub/media/")
      ? thumbUrl
      : `/hub/media/${id}/thumb`,
    ...(filename ? { filename } : {}),
  };
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; preview: string | null; pct: number }
  | { kind: "processing"; name: string; preview: string | null };

function objectUrl(file: File): string | null {
  try {
    return typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : null;
  } catch {
    return null;
  }
}

function revoke(url: string | null) {
  if (url && typeof URL.revokeObjectURL === "function")
    URL.revokeObjectURL(url);
}

export function ImageUpload({
  kind,
  label,
  helper,
  value,
  id,
  labelExtra,
  multiple = false,
  max,
  suggestedAlt = "",
  altRequired = false,
  onUploaded,
  onAltChange,
  onRemove,
  onRestore,
  onReorder,
  onPick,
  firstLabel,
  readOnly = false,
  endpoint = "/hub/api/media",
}: ImageUploadProps) {
  const auto = useId();
  const base = id ?? `upload-${auto.replace(/[^a-z0-9]/gi, "")}`;
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const xhrRef = useRef<{ abort(): void } | null>(null);
  const previewRef = useRef<string | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const limit = max ?? (multiple ? 12 : 1);
  // Photos that arrived already saved (not uploaded in this visit): a required description
  // that is still empty shows its hint at once (D280), not only after a blur.
  const loaded = useRef(new Set(value.map((v) => v.id)));

  useEffect(
    () => () => {
      xhrRef.current?.abort();
      revoke(previewRef.current);
    },
    [],
  );

  function finish() {
    xhrRef.current = null;
    revoke(previewRef.current);
    previewRef.current = null;
    setPhase({ kind: "idle" });
  }

  function start(file: File | undefined) {
    if (!file || readOnly || phase.kind !== "idle") return;
    const problem = checkFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    if (kind === "moodboard") onPick?.(file);
    const preview = objectUrl(file);
    previewRef.current = preview;
    setPhase({ kind: "uploading", name: file.name, preview, pct: 0 });

    const body = new FormData();
    body.append("file", file);
    body.append("kind", kind);
    body.append("alt", suggestedAlt);
    xhrRef.current = startXhr(
      {
        method: "POST",
        url: endpoint,
        body,
        onProgress: (loaded, total) => {
          const pct = Math.min(100, Math.round((loaded / total) * 100));
          if (pct >= 100) {
            setPhase({ kind: "processing", name: file.name, preview });
            return;
          }
          setPhase((p) => (p.kind === "uploading" ? { ...p, pct } : p));
        },
        onUploaded: () => {
          setPhase({ kind: "processing", name: file.name, preview });
        },
      },
      (outcome) => {
        if (!outcome.ok) {
          finish();
          if (outcome.error instanceof NetworkError) setError(UPL_COPY.failed);
          return;
        }
        const { status, json } = outcome.result;
        const asset =
          status >= 200 && status < 300
            ? mediaViewFromServer(json.asset, file.name)
            : null;
        finish();
        if (asset) {
          onUploaded(asset, json.proposal);
          return;
        }
        const message = typeof json.error === "string" ? json.error : "";
        setError(
          message &&
            message !== "signed_out" &&
            message !== "forbidden" &&
            message !== "not_found"
            ? message
            : status === 401
              ? "Your session has ended. Sign in again to keep going."
              : UPL_COPY.failed,
        );
      },
    );
  }

  function stop() {
    xhrRef.current?.abort();
  }

  function remove(asset: MediaAssetView) {
    onRemove(asset.id);
    toast.show({
      message: PHOTO_REMOVED_COPY,
      ...(onRestore
        ? { action: { label: "Undo", onClick: () => onRestore(asset.id) } }
        : {}),
    });
  }

  const full = value.length >= limit;
  const busy = phase.kind !== "idle";
  const inputLabel = kind === "logo" ? "Choose a logo" : "Choose a photo";

  const progress =
    phase.kind === "idle" ? null : (
      <div className="flex items-start gap-4">
        {phase.preview ? (
          <img
            src={phase.preview}
            alt=""
            className="h-24 w-24 shrink-0 rounded object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="h-24 w-24 shrink-0 rounded bg-hub-surface-2"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="truncate text-base text-hub-ink">{phase.name}</p>
          {phase.kind === "uploading" ? (
            <>
              <div
                role="progressbar"
                aria-label={`Uploading ${phase.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={phase.pct}
                aria-valuetext={`${phase.pct} percent uploaded`}
                className="h-1 w-full overflow-hidden rounded-full bg-hub-surface-2"
              >
                <div
                  className="h-full bg-hub-accent transition-[width] duration-150 motion-reduce:transition-none"
                  style={{ width: `${phase.pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-hub-ink-muted tabular-nums">
                  Uploading… {phase.pct}%
                </span>
                <Button variant="ghost" size="sm" onClick={stop}>
                  Stop upload
                </Button>
              </div>
            </>
          ) : (
            <>
              <div
                role="progressbar"
                aria-label={`Processing ${phase.name}`}
                aria-valuetext={PROCESSING_COPY}
                className="h-1 w-full overflow-hidden rounded-full bg-hub-surface-2"
              >
                <div className="h-full w-1/3 animate-pulse bg-hub-accent motion-reduce:animate-none" />
              </div>
              <span className="text-sm text-hub-ink-muted">
                {PROCESSING_COPY}
              </span>
            </>
          )}
        </div>
      </div>
    );

  const replaceInput = (
    <input
      ref={replaceRef}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        start(file);
      }}
    />
  );

  return (
    <div
      role="group"
      aria-labelledby={`${base}-label`}
      id={base}
      tabIndex={-1}
      className="flex flex-col gap-3 font-hub outline-none"
    >
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <span
            id={`${base}-label`}
            className="text-sm font-semibold text-hub-ink"
          >
            {label}
          </span>
          {labelExtra}
        </span>
        <p className="text-sm text-hub-ink-muted">{helper}</p>
      </div>

      {multiple ? (
        value.length > 0 ? (
          <GalleryGrid
            items={value}
            readOnly={readOnly}
            altRequired={altRequired}
            loaded={loaded.current}
            firstLabel={firstLabel}
            onAltChange={onAltChange}
            onRemove={remove}
            onReorder={onReorder}
          />
        ) : null
      ) : !busy && value[0] ? (
        <DoneCard
          asset={value[0]}
          kind={kind}
          readOnly={readOnly}
          altRequired={altRequired}
          flagEmpty={loaded.current.has(value[0].id)}
          suggestedAlt={suggestedAlt}
          onAltChange={onAltChange}
          onReplace={() => replaceRef.current?.click()}
          onRemove={remove}
        />
      ) : null}

      {progress}

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

      {readOnly || busy ? null : multiple && full ? (
        <p className="text-sm text-hub-ink-muted">{limitCopy(kind, limit)}</p>
      ) : multiple || !value[0] ? (
        <PhotoDrop
          inputId={`${base}-input`}
          inputLabel={inputLabel}
          compact={kind === "team"}
          onFile={start}
        />
      ) : null}
      {!multiple && value[0] && !readOnly ? replaceInput : null}
    </div>
  );
}

function PhotoDrop({
  inputId,
  inputLabel,
  compact,
  onFile,
}: {
  inputId: string;
  inputLabel: string;
  compact: boolean;
  onFile: (file: File | undefined) => void;
}) {
  const [over, setOver] = useState(false);
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    onFile(e.dataTransfer?.files?.[0]);
  }
  return (
    <div
      data-file-drop=""
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={
        "flex flex-col items-center justify-center gap-2 rounded p-6 text-center " +
        "text-base text-hub-ink transition-colors duration-150 " +
        (compact ? "min-h-32 " : "min-h-40 ") +
        (over
          ? "border-2 border-dashed border-hub-accent bg-hub-accent-tint"
          : "border border-dashed border-hub-border-strong bg-hub-surface-2")
      }
    >
      <ImagePlus aria-hidden size={20} strokeWidth={2} />
      <p>
        <span className="pointer-coarse:hidden">Drop a photo here, or </span>
        <label
          htmlFor={inputId}
          className={
            "cursor-pointer rounded text-hub-accent underline underline-offset-2 " +
            "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 " +
            "has-focus-visible:outline-hub-accent pointer-coarse:font-semibold"
          }
        >
          <span className="pointer-coarse:hidden">choose a photo</span>
          <span className="hidden pointer-coarse:inline">Choose a photo</span>
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={inputLabel}
            className="sr-only"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              // Clear it so choosing the same file again fires again.
              e.currentTarget.value = "";
              onFile(file);
            }}
          />
        </label>
      </p>
      <p className="text-sm text-hub-ink-muted">
        JPEG, PNG or WebP, up to 20 MB
      </p>
    </div>
  );
}

function AltField({
  asset,
  readOnly,
  required,
  suggestion,
  onSave,
  compact = false,
  flagEmpty = false,
}: {
  asset: MediaAssetView;
  readOnly: boolean;
  required: boolean;
  suggestion: string;
  onSave: (id: string, alt: string) => void | Promise<boolean>;
  compact?: boolean;
  /** Saved earlier with no description: show the hint without waiting for a blur. */
  flagEmpty?: boolean;
}) {
  const [text, setText] = useState(asset.alt || suggestion);
  const [touched, setTouched] = useState(flagEmpty && !asset.alt.trim());
  const [saveFailed, setSaveFailed] = useState(false);
  // The last description known to be stored (or on its way). A failed save puts the older
  // value back, so the next blur with the same text sends it again (B-WR-07).
  const saved = useRef(asset.alt);
  const missing = required && touched && text.trim() === "";
  return (
    <TextField
      id={`alt-${asset.id}`}
      label="Photo description"
      helper={compact ? undefined : ALT_HELPER}
      error={
        missing
          ? ALT_MISSING_COPY
          : saveFailed
            ? ALT_SAVE_FAILED_COPY
            : undefined
      }
      required={required}
      maxLength={250}
      value={text}
      disabled={readOnly}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setTouched(true);
        const v = text.trim();
        if (v === saved.current) return;
        const before = saved.current;
        saved.current = v;
        const outcome = onSave(asset.id, v);
        if (!outcome) return;
        const failed = () => {
          if (saved.current === v) saved.current = before;
          setSaveFailed(true);
        };
        outcome.then((ok) => {
          if (ok) setSaveFailed(false);
          else failed();
        }, failed);
      }}
    />
  );
}

function DoneCard({
  asset,
  kind,
  readOnly,
  altRequired,
  flagEmpty,
  suggestedAlt,
  onAltChange,
  onReplace,
  onRemove,
}: {
  asset: MediaAssetView;
  kind: MediaUploadKind;
  readOnly: boolean;
  altRequired: boolean;
  flagEmpty: boolean;
  suggestedAlt: string;
  onAltChange: (id: string, alt: string) => void | Promise<boolean>;
  onReplace: () => void;
  onRemove: (a: MediaAssetView) => void;
}) {
  const low = lowResCopy(kind, asset.webWidth);
  return (
    <div className="flex flex-col gap-4 rounded border border-hub-border p-4">
      <div className="flex flex-wrap items-start gap-4">
        {kind === "logo" ? (
          <div className="flex gap-2" data-logo-preview="">
            {(
              [
                ["On light", "bg-[#FFFFFF]"],
                ["On dark", "bg-[#1B1B19]"],
              ] as const
            ).map(([caption, bg]) => (
              <figure key={caption} className="flex flex-col gap-1">
                <div
                  className={`flex h-24 w-48 items-center justify-center rounded border border-hub-border p-2 ${bg}`}
                >
                  <img
                    src={asset.thumbUrl}
                    alt={caption === "On light" ? asset.alt : ""}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <figcaption className="text-sm text-hub-ink-muted">
                  {caption}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <img
            src={asset.thumbUrl}
            alt={asset.alt}
            className="h-24 w-24 shrink-0 rounded object-cover"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {asset.filename ? (
            <p className="truncate text-base text-hub-ink">{asset.filename}</p>
          ) : null}
          <p className="text-sm text-hub-ink-muted tabular-nums">
            {mediaMeta(asset)}
          </p>
          {readOnly ? null : (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={onReplace}>
                Replace
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onRemove(asset)}>
                Remove
              </Button>
            </div>
          )}
        </div>
      </div>
      {low ? <InlineAlert tone="warning">{low}</InlineAlert> : null}
      <AltField
        key={asset.id}
        asset={asset}
        readOnly={readOnly}
        required={altRequired}
        flagEmpty={flagEmpty}
        suggestion={suggestedAlt}
        onSave={onAltChange}
      />
    </div>
  );
}

function GalleryTile({
  asset,
  index,
  total,
  readOnly,
  altRequired,
  flagEmpty,
  label,
  onAltChange,
  onRemove,
  onMove,
}: {
  asset: MediaAssetView;
  index: number;
  total: number;
  readOnly: boolean;
  altRequired: boolean;
  flagEmpty: boolean;
  label?: string;
  onAltChange: (id: string, alt: string) => void | Promise<boolean>;
  onRemove: (a: MediaAssetView) => void;
  onMove?: (from: number, to: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: asset.id, disabled: readOnly || !onMove });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
  };
  const name = `photo ${index + 1}`;
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-media-id={asset.id}
      className={
        "flex flex-col gap-2 rounded border border-hub-border bg-hub-surface p-2 " +
        (isDragging ? "shadow-lg" : "")
      }
    >
      <img
        src={asset.thumbUrl}
        alt={asset.alt}
        className="aspect-square w-full rounded object-cover"
      />
      {label ? (
        <span className="text-sm font-semibold text-hub-ink">{label}</span>
      ) : null}
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-1">
          {onMove ? (
            <>
              <IconButton
                {...attributes}
                {...listeners}
                size="sm"
                tooltipAlign="start"
                label={`Reorder ${name}`}
                icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
                className="cursor-grab touch-none active:cursor-grabbing"
              />
              <IconButton
                size="sm"
                label={`Move ${name} earlier`}
                aria-disabled={index === 0 || undefined}
                icon={<ArrowLeft aria-hidden size={16} strokeWidth={2} />}
                onClick={() => {
                  if (index > 0) onMove(index, index - 1);
                }}
              />
              <IconButton
                size="sm"
                label={`Move ${name} later`}
                aria-disabled={index === total - 1 || undefined}
                icon={<ArrowRight aria-hidden size={16} strokeWidth={2} />}
                onClick={() => {
                  if (index < total - 1) onMove(index, index + 1);
                }}
              />
            </>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => onRemove(asset)}>
            Remove
          </Button>
        </div>
      )}
      <AltField
        key={asset.id}
        asset={asset}
        readOnly={readOnly}
        required={altRequired}
        flagEmpty={flagEmpty}
        suggestion=""
        onSave={onAltChange}
        compact
      />
    </li>
  );
}

function GalleryGrid({
  items,
  readOnly,
  altRequired,
  loaded,
  firstLabel,
  onAltChange,
  onRemove,
  onReorder,
}: {
  items: MediaAssetView[];
  readOnly: boolean;
  altRequired: boolean;
  loaded: ReadonlySet<string>;
  firstLabel?: string;
  onAltChange: (id: string, alt: string) => void | Promise<boolean>;
  onRemove: (a: MediaAssetView) => void;
  onReorder?: (ids: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = items.map((i) => i.id);
  const move = onReorder
    ? (from: number, to: number) => onReorder(arrayMove(ids, from, to))
    : undefined;
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || !move) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    move(from, to);
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((a, i) => (
            <GalleryTile
              key={a.id}
              asset={a}
              index={i}
              total={items.length}
              readOnly={readOnly}
              altRequired={altRequired}
              flagEmpty={loaded.has(a.id)}
              {...(i === 0 && firstLabel ? { label: firstLabel } : {})}
              onAltChange={onAltChange}
              onRemove={onRemove}
              onMove={move}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
