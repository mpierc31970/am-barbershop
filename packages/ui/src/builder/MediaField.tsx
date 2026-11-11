"use client";
// MediaField: every image, video and audio field in the builder (07-17; CONT-14, D-UI-P7-5,
// D-UI-P7-10; 07-UI-SPEC "Media picker", "Column items" Image row). Consumers: the Image item
// here, 07-22 gallery / logo strip (multiple), 07-23 video / audio items and the video cover,
// 07-30 share image.
//   Empty: a "Choose a photo" drop target (MediaDropZone look) that opens MediaPicker; the
//     picker's Upload tab does the uploading.
//   Chosen: thumb (photo / video poster / AudioLines), name, Replace · Remove.
//   Deleted from the library (D275): the thumb with "Deleted from your media" and Choose
//     another (choice 12; 07-28 may refine it).
// Values are library ids; each is looked up once through `source.items` (default
// fetchMediaSource) so the field can show it. onChange gets the picker's PickedMedia list in
// pick order (an empty list on Remove).
// 07-30: `allowStock` passes through to the picker (Free photos, single image only), and
// `stockValue` shows a chosen stock photo (by URL, with its credit) with Replace · Remove.
import { AudioLines, Film, ImagePlus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "../hub/Button";
import {
  MEDIA_COPY,
  photoByLabel,
  pickerTitle,
  type LibraryItemView,
  type MediaKind,
  type PickedMedia,
} from "../hub/media/copy";
import { fetchMediaSource, type MediaSource } from "../hub/media/source";
import type { StockSourceClient } from "../hub/media/stock-source";
import { MediaPicker } from "../hub/MediaPicker";

export interface MediaFieldProps {
  id: string;
  label: string;
  helper?: string;
  kind: MediaKind;
  multiple?: boolean;
  /** One library id ("" = none) or, for `multiple`, the ids in order. */
  value: string | readonly string[];
  onChange(picked: PickedMedia[]): void;
  error?: string;
  source?: MediaSource;
  disabled?: boolean;
  /** 07-30: offer Free photos in the picker (single image only). */
  allowStock?: boolean;
  /** 07-30: test seam for Free photos. */
  stock?: StockSourceClient;
  /** 07-30: a chosen stock photo (shown when no library id is set). */
  stockValue?: { url: string; creditName: string } | null;
}

const ID = /^[a-z0-9]{1,32}$/i;

function idsOf(value: string | readonly string[]): string[] {
  const list = typeof value === "string" ? [value] : [...value];
  return list.filter((v) => ID.test(v));
}

function Thumb({
  item,
  kind,
}: {
  item: LibraryItemView | undefined;
  kind: MediaKind;
}) {
  const src = item
    ? item.kind === "video"
      ? item.posterUrl
      : item.thumbUrl
    : null;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-16 w-16 shrink-0 rounded bg-hub-surface-2 object-cover"
      />
    );
  }
  const Icon =
    kind === "audio" ? AudioLines : kind === "video" ? Film : ImagePlus;
  return (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-hub-surface-2 text-hub-ink-muted">
      <Icon aria-hidden size={20} strokeWidth={2} />
    </span>
  );
}

export function MediaField({
  id,
  label,
  helper,
  kind,
  multiple = false,
  value,
  onChange,
  error,
  source = fetchMediaSource,
  disabled = false,
  allowStock = false,
  stock,
  stockValue = null,
}: MediaFieldProps) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [known, setKnown] = useState<ReadonlyMap<string, LibraryItemView>>(
    new Map(),
  );
  const ids = idsOf(value);
  const missing = ids.filter((i) => !known.has(i)).join(",");

  // Look up the chosen ids the field doesn't know yet (on mount and after a value change).
  useEffect(() => {
    if (missing === "") return;
    let live = true;
    void source.items(missing.split(",")).then((res) => {
      if (!live || !res.ok) return;
      setKnown((m) => {
        const next = new Map(m);
        for (const it of res.data) next.set(it.id, it);
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [missing, source]);

  function use(picked: PickedMedia[]) {
    setKnown((m) => {
      const next = new Map(m);
      for (const p of picked) {
        if (p.id === "") continue;
        next.set(p.id, {
          id: p.id,
          kind: p.kind,
          rowKind: "",
          name: p.name,
          alt: p.alt,
          needsDescription: p.needsDescription,
          status: "ready",
          width: p.width,
          height: p.height,
          bytes: 0,
          durationS: 0,
          createdAt: "",
          thumbUrl: p.thumbUrl,
          previewUrl: "",
          posterUrl: p.kind === "video" ? p.thumbUrl : null,
          ...(p.deleted ? { deleted: true } : {}),
        });
      }
      return next;
    });
    onChange(picked);
  }

  const chooseLabel = pickerTitle(kind, multiple);
  const describedBy =
    [helper ? `${id}-helper` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex flex-col gap-2 font-hub"
      data-media-field={kind}
    >
      <span id={labelId} className="text-sm font-semibold text-hub-ink">
        {label}
      </span>
      {ids.length === 0 && stockValue && stockValue.url ? (
        <ul className="flex flex-col gap-2">
          <li className="flex items-center gap-4" data-media-field-stock="">
            <img
              src={stockValue.url}
              alt=""
              className="h-16 w-16 shrink-0 rounded bg-hub-surface-2 object-cover"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-hub-ink-muted">
              {stockValue.creditName
                ? photoByLabel(stockValue.creditName)
                : "Photo from a link"}
            </span>
          </li>
          <li className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              aria-describedby={describedBy}
              onClick={() => setOpen(true)}
            >
              Replace
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange([])}
            >
              Remove
            </Button>
          </li>
        </ul>
      ) : ids.length === 0 ? (
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-describedby={describedBy}
          onClick={() => setOpen(true)}
          className={
            "flex min-h-24 flex-col items-center justify-center gap-2 rounded border border-dashed " +
            `${error ? "border-hub-danger" : "border-hub-border-strong"} bg-hub-surface-2 p-4 ` +
            "text-base text-hub-ink transition-colors duration-150 hover:border-hub-ink-muted " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent " +
            "disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          <ImagePlus aria-hidden size={20} strokeWidth={2} />
          {chooseLabel}
        </button>
      ) : (
        <ul className="flex flex-col gap-2">
          {ids.map((mid) => {
            const it = known.get(mid);
            return (
              <li
                key={mid}
                className="flex items-center gap-4"
                data-media-field-item={mid}
              >
                <Thumb item={it} kind={kind} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className="truncate text-sm text-hub-ink"
                    title={it?.name}
                  >
                    {it?.name ?? "…"}
                  </span>
                  {it?.deleted ? (
                    <span className="text-sm text-hub-ink-muted">
                      {MEDIA_COPY.deletedField}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
          <li className="flex flex-wrap gap-2">
            {ids.some((i) => known.get(i)?.deleted) ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => setOpen(true)}
              >
                Choose another
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                aria-describedby={describedBy}
                onClick={() => setOpen(true)}
              >
                Replace
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange([])}
            >
              Remove
            </Button>
          </li>
        </ul>
      )}
      {helper ? (
        <p id={`${id}-helper`} className="text-sm text-hub-ink-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
      <MediaPicker
        open={open}
        kind={kind}
        multiple={multiple}
        source={source}
        allowStock={allowStock}
        {...(stock ? { stock } : {})}
        onUse={use}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
