"use client";
// GalleryEditor (07-22; CONT-22, D228, D-UI-P7-5, D119/D120; 07-UI-SPEC row "Gallery" line 357,
// Description field line 255, media picker lines 266-268, Undo copy line 664, drag-sort
// a11y line 686; D311 admin pattern; replaces the 07-06 stub body, name and BUILDER_BLOCKS_A
// entry kept).
//
// Heading · Display (Grid / Mosaic / Slider, drawn thumbs) · Columns (Grid only) · Photos per
// page (not Slider) · Show captions · Open photos larger when clicked · Photos.
// Photos is a grid of 96px thumbs on dnd-kit (rectSortingStrategy) composed from
// ItemListEditor's helpers (decision 4; SortableList is a vertical row list), with a grip
// handle and Move photo N earlier / later buttons (WCAG 2.5.7) and polite announcements.
// Clicking a thumb opens an inline panel (a disclosure, not a dialog): Description (pre-fill
// from the library), Caption, Next photo that needs a description, Remove from gallery (Undo).
// Bulk add (decision 5): Add photos opens MediaPicker (multi) and APPENDS the picks; dropping
// files uploads them through useMediaUploads and appends each finished upload. Pre-fill rule
// in gallery-logic.ts (decision 6): amber "Needs description" until the owner edits it.
// Library backfill (decision 7): on blur, a description typed for a photo whose library item
// has none is also saved to the library once; a failure keeps it here ("Saved here only.").
// Limits and copy come from @cds/core/content. Hub tokens and hub primitives only.
import {
  DndContext,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Images,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  GALLERY_LIMITS,
  GALLERY_MAX_COPY,
  newId,
  type GalleryDisplay,
  type GalleryImage,
} from "@cds/core/content";
import { Badge } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { IconButton } from "../../hub/IconButton";
import { MediaDropZone } from "../../hub/MediaDropZone";
import { MediaPicker } from "../../hub/MediaPicker";
import { RadioCardGroup } from "../../hub/RadioCardGroup";
import { Switch } from "../../hub/Switch";
import { UNDO_TOAST_MS, useToast } from "../../hub/Toast";
import { InlineAlert } from "../../hub/feedback";
import { Select, TextArea, TextField } from "../../hub/fields";
import {
  MEDIA_COPY,
  pickedOf,
  type LibraryItemView,
  type PickedMedia,
} from "../../hub/media/copy";
import { fetchMediaSource } from "../../hub/media/source";
import { useMediaUploads } from "../../hub/useMediaUploads";
import { DRAG_INSTRUCTIONS, announce } from "../editor-logic";
import {
  itemListCollision,
  liftClasses,
  useDndSensors,
  useReducedMotion,
} from "../ItemListEditor";
import {
  countNeedingDescription,
  galleryImagesFromPicks,
  moveItem,
  nextNeedingDescription,
} from "./gallery-logic";
import { reinsertItem, useLatest } from "./SortableList";
import type { CoreBlockEditorProps } from "./types";

export const GALLERY_DESCRIPTION_HELPER =
  "Describe the photo for people who can't see it, like 'Loaves cooling on a rack' (also called alt text).";
export const GALLERY_REMOVED_TOAST = "Photo removed from the gallery.";
export const GALLERY_SAVED_HERE_ONLY = "Saved here only.";
const ITEMS_CHUNK = 60;

/** What a thumb needs to know about its library item. */
export type GalleryThumbInfo = {
  name: string;
  alt: string;
  needsDescription: boolean;
  thumbUrl: string | null;
  deleted?: boolean;
};

const infoOfItem = (it: LibraryItemView | PickedMedia): GalleryThumbInfo => ({
  name: it.name,
  alt: it.alt,
  needsDescription: it.needsDescription,
  thumbUrl: it.thumbUrl,
  ...(it.deleted ? { deleted: true } : {}),
});

const DISPLAYS: readonly GalleryDisplay[] = ["grid", "mosaic", "slider"];

function readImages(content: Record<string, unknown>): GalleryImage[] {
  const raw = Array.isArray(content.images)
    ? (content.images as unknown[])
    : [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return raw
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === "object" && x !== null && !Array.isArray(x),
    )
    .map((x, i) => ({
      id: str(x.id) || `photo-${i}`,
      asset: str(x.asset),
      alt: str(x.alt),
      alt_reviewed: x.alt_reviewed !== false,
      caption: str(x.caption),
    }));
}

/** Library items for the gallery's assets, fetched in chunks of 60 as new ids appear. */
function useLibraryInfo(assets: readonly string[]) {
  const [known, setKnown] = useState<ReadonlyMap<string, GalleryThumbInfo>>(
    () => new Map(),
  );
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const missing = [...new Set(assets.filter((a) => a && !known.has(a)))].join(
    ",",
  );

  useEffect(() => {
    if (missing === "") return;
    let live = true;
    const ids = missing.split(",");
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += ITEMS_CHUNK) {
      chunks.push(ids.slice(i, i + ITEMS_CHUNK));
    }
    void Promise.all(chunks.map((c) => fetchMediaSource.items(c))).then(
      (results) => {
        if (!live) return;
        if (results.some((r) => !r.ok)) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setKnown((m) => {
          const next = new Map(m);
          for (const r of results) {
            if (r.ok) for (const it of r.data) next.set(it.id, infoOfItem(it));
          }
          // An id the library no longer returns shows as deleted (never a spinner forever).
          for (const id of ids) {
            if (!next.has(id)) {
              next.set(id, {
                name: "",
                alt: "",
                needsDescription: false,
                thumbUrl: null,
                deleted: true,
              });
            }
          }
          return next;
        });
      },
    );
    return () => {
      live = false;
    };
  }, [missing, attempt]);

  const learn = (entries: readonly [string, GalleryThumbInfo][]) =>
    setKnown((m) => {
      const next = new Map(m);
      for (const [id, info] of entries) next.set(id, info);
      return next;
    });

  return {
    known,
    failed: failed && missing !== "",
    retry: () => setAttempt((n) => n + 1),
    learn,
  };
}

/** Small drawn previews for the Display cards (CSS boxes, no images). */
function DisplayThumb({ display }: { display: GalleryDisplay }) {
  const box = "rounded-sm bg-hub-border-strong";
  if (display === "grid") {
    return (
      <span aria-hidden className="grid h-8 w-12 grid-cols-3 gap-0.5">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={box} />
        ))}
      </span>
    );
  }
  if (display === "mosaic") {
    return (
      <span aria-hidden className="flex h-8 w-12 flex-col gap-0.5">
        <span className="flex flex-1 gap-0.5">
          <span className={`${box} grow-[3]`} />
          <span className={`${box} grow-[2]`} />
        </span>
        <span className="flex flex-1 gap-0.5">
          <span className={`${box} grow-[2]`} />
          <span className={`${box} grow`} />
          <span className={`${box} grow-[2]`} />
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden className="flex h-8 w-12 flex-col items-center gap-0.5">
      <span className={`${box} w-full flex-1`} />
      <span className="flex gap-0.5">
        <span className="size-1 rounded-full bg-hub-ink" />
        <span className="size-1 rounded-full bg-hub-border-strong" />
        <span className="size-1 rounded-full bg-hub-border-strong" />
      </span>
    </span>
  );
}

const DISPLAY_OPTIONS = [
  {
    value: "grid" as const,
    title: "Grid",
    description: "Even squares in columns",
    adornment: <DisplayThumb display="grid" />,
  },
  {
    value: "mosaic" as const,
    title: "Mosaic",
    description: "Rows that keep each photo's shape",
    adornment: <DisplayThumb display="mosaic" />,
  },
  {
    value: "slider" as const,
    title: "Slider",
    description: "One photo at a time",
    adornment: <DisplayThumb display="slider" />,
  },
];

const COLUMN_OPTIONS = Array.from(
  { length: GALLERY_LIMITS.columnsMax - GALLERY_LIMITS.columnsMin + 1 },
  (_, i) => {
    const n = GALLERY_LIMITS.columnsMin + i;
    return { value: String(n), label: String(n) };
  },
);
const PER_PAGE_OPTIONS = GALLERY_LIMITS.perPageChoices.map((n) => ({
  value: String(n),
  label: String(n),
}));

export function GalleryEditor({
  content,
  onChange,
  errors,
}: CoreBlockEditorProps) {
  const uid = useId();
  const toast = useToast();
  const sensors = useDndSensors();
  const images = readImages(content);
  const latest = useLatest(images);
  const heading = typeof content.heading === "string" ? content.heading : "";
  const display: GalleryDisplay = DISPLAYS.includes(
    content.display as GalleryDisplay,
  )
    ? (content.display as GalleryDisplay)
    : "grid";
  const columns =
    typeof content.columns === "number"
      ? content.columns
      : GALLERY_LIMITS.columnsDefault;
  const perPage =
    typeof content.per_page === "number"
      ? content.per_page
      : GALLERY_LIMITS.perPageDefault;
  const showCaptions = content.show_captions === true;
  const lightbox = content.lightbox !== false;
  const atMax = images.length >= GALLERY_LIMITS.maxImages;

  const { known, failed, retry, learn } = useLibraryInfo(
    images.map((i) => i.asset),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [batchNote, setBatchNote] = useState(false);
  const [hereOnly, setHereOnly] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const described = useRef(new Set<string>());
  const chain = useRef<Promise<void>>(Promise.resolve());

  const setImages = (next: GalleryImage[]) => {
    latest.current = next;
    onChange("images", next);
  };

  function append(picks: readonly PickedMedia[]) {
    if (picks.length === 0) return;
    learn(picks.map((p) => [p.id, infoOfItem(p)]));
    const r = galleryImagesFromPicks(latest.current, picks, newId);
    if (r.added.length > 0) setImages(r.images);
    if (r.overflow) toast.show({ message: GALLERY_MAX_COPY });
    if (r.added.some((i) => !i.alt_reviewed)) setBatchNote(true);
  }

  const uploads = useMediaUploads({
    kinds: ["image"],
    onUploaded(assetId) {
      chain.current = chain.current.then(async () => {
        const res = await fetchMediaSource.items([assetId]);
        if (res.ok && res.data[0]) append([pickedOf(res.data[0])]);
      });
    },
  });

  const amberCount = countNeedingDescription(images);
  const selIndex = selected ? images.findIndex((i) => i.id === selected) : -1;
  const current = selIndex >= 0 ? images[selIndex] : undefined;

  const labelOf = (index: number) => `Photo ${index + 1}`;
  const nameOf = (id: unknown) => {
    const i = latest.current.findIndex((x) => x.id === id);
    return i >= 0 ? labelOf(i) : "Photo";
  };
  const pos = (id: unknown) => latest.current.findIndex((x) => x.id === id) + 1;
  const total = () => latest.current.length;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      announce.pickUp(nameOf(active.id), pos(active.id), total()),
    onDragOver: ({ active, over }) =>
      over
        ? announce.over(nameOf(active.id), pos(over.id), total())
        : undefined,
    onDragEnd: ({ active, over }) =>
      announce.drop(
        nameOf(active.id),
        over ? pos(over.id) : pos(active.id),
        total(),
      ),
    onDragCancel: ({ active }) =>
      announce.cancel(nameOf(active.id), pos(active.id)),
  };

  function move(from: number, to: number) {
    const list = latest.current;
    if (to < 0 || to >= list.length || from === to) return;
    const name = labelOf(from);
    setImages(moveItem(list, from, to));
    setLive(`${name} moved to position ${to + 1}.`);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const list = latest.current;
    const from = list.findIndex((x) => x.id === active.id);
    const to = list.findIndex((x) => x.id === over.id);
    if (from === -1 || to === -1) return;
    move(from, to);
  }

  function patch(id: string, p: Partial<GalleryImage>) {
    setImages(latest.current.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  function remove(index: number) {
    const item = latest.current[index];
    if (!item) return;
    setImages(latest.current.filter((_, k) => k !== index));
    if (selected === item.id) setSelected(null);
    toast.show({
      message: GALLERY_REMOVED_TOAST,
      action: {
        label: "Undo",
        onClick: () => {
          if (latest.current.length >= GALLERY_LIMITS.maxImages) return;
          setImages(reinsertItem(latest.current, item, index));
        },
      },
      durationMs: UNDO_TOAST_MS,
    });
  }

  function backfill(image: GalleryImage) {
    const info = known.get(image.asset);
    const alt = image.alt.trim();
    if (!info || !info.needsDescription || info.deleted) return;
    if (!image.alt_reviewed || alt === "") return;
    if (described.current.has(image.asset)) return;
    described.current.add(image.asset);
    void fetchMediaSource.describe([{ id: image.asset, alt }]).then((res) => {
      if (res.ok) {
        learn([[image.asset, { ...info, alt, needsDescription: false }]]);
      } else {
        setHereOnly((s) => new Set(s).add(image.id));
      }
    });
  }

  function openNextAmber(from: number) {
    const next = nextNeedingDescription(latest.current, from);
    if (next >= 0) {
      setSelected(latest.current[next]!.id);
      setTimeout(() => document.getElementById(`${uid}-alt`)?.focus(), 0);
    }
  }

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        labelExtra={
          <span className="text-sm text-hub-ink-muted">Optional</span>
        }
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />

      <RadioCardGroup<GalleryDisplay>
        name={`${uid}-display`}
        legend="Display"
        options={DISPLAY_OPTIONS}
        value={display}
        onChange={(v) => onChange("display", v)}
      />

      {display !== "slider" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {display === "grid" ? (
            <Select
              id={`${uid}-columns`}
              label="Columns"
              helper="Phones always show 2."
              options={COLUMN_OPTIONS}
              value={String(columns)}
              error={errors.columns}
              onChange={(e) =>
                onChange("columns", Number(e.currentTarget.value))
              }
            />
          ) : null}
          <Select
            id={`${uid}-per-page`}
            label="Photos per page"
            helper="More photos get numbered pages."
            options={PER_PAGE_OPTIONS}
            value={String(perPage)}
            error={errors.per_page}
            onChange={(e) =>
              onChange("per_page", Number(e.currentTarget.value))
            }
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <Switch
          id={`${uid}-captions`}
          label="Show captions"
          checked={showCaptions}
          onChange={(v) => onChange("show_captions", v)}
        />
        <Switch
          id={`${uid}-lightbox`}
          label="Open photos larger when clicked"
          checked={lightbox}
          onChange={(v) => onChange("lightbox", v)}
        />
      </div>

      <section
        aria-labelledby={`${uid}-photos`}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3
              id={`${uid}-photos`}
              className="text-sm font-semibold text-hub-ink"
            >
              Photos
            </h3>
            <p className="text-sm tabular-nums text-hub-ink-muted">
              {`${images.length} of ${GALLERY_LIMITS.maxImages}`}
            </p>
          </div>
          <Button
            variant="secondary"
            icon={<Images aria-hidden size={16} strokeWidth={2} />}
            disabled={atMax}
            aria-describedby={atMax ? `${uid}-max` : undefined}
            onClick={() => setPickerOpen(true)}
          >
            Add photos
          </Button>
        </div>
        {atMax ? (
          <p id={`${uid}-max`} className="text-sm text-hub-ink-muted">
            {GALLERY_MAX_COPY}
          </p>
        ) : null}

        <div aria-live="polite" className="text-sm text-hub-ink">
          {batchNote && amberCount > 0 ? (
            <p className="flex flex-wrap items-center gap-2">
              <span>
                {amberCount === 1
                  ? "1 photo needs a description."
                  : `${amberCount} photos need a description.`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="font-semibold text-hub-accent underline underline-offset-2"
                onClick={() => {
                  setBatchNote(false);
                  openNextAmber(-1);
                }}
              >
                Describe them
              </Button>
            </p>
          ) : null}
        </div>

        {failed ? (
          <InlineAlert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={retry}>
                Try again
              </Button>
            }
          >
            {MEDIA_COPY.errLoad}
          </InlineAlert>
        ) : null}

        {images.length > 0 || uploads.tiles.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={itemListCollision}
            onDragEnd={onDragEnd}
            accessibility={{
              announcements,
              screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS },
            }}
          >
            <SortableContext
              items={images.map((x) => x.id)}
              strategy={rectSortingStrategy}
            >
              <ul
                data-gallery-thumbs=""
                className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-4"
              >
                {images.map((image, index) => {
                  const info = known.get(image.asset);
                  const desc =
                    image.alt.trim() || info?.alt.trim() || info?.name || "";
                  return (
                    <SortableThumb
                      key={image.id}
                      id={image.id}
                      index={index}
                      count={images.length}
                      info={info}
                      loading={!info && !failed}
                      amber={!image.alt_reviewed}
                      selected={image.id === selected}
                      name={`${labelOf(index)}: ${desc}${image.alt_reviewed ? "" : ", needs description"}`}
                      onOpen={() =>
                        setSelected((s) => (s === image.id ? null : image.id))
                      }
                      onMove={(dir) => move(index, index + dir)}
                    />
                  );
                })}
                {uploads.tiles.map((tile) => (
                  <li
                    key={tile.key}
                    data-gallery-upload=""
                    className="flex w-24 flex-col gap-1"
                  >
                    <div className="relative size-24 overflow-hidden rounded border border-hub-border bg-hub-surface-2">
                      {tile.preview ? (
                        <img
                          src={tile.preview}
                          alt=""
                          className="size-full object-cover opacity-60"
                        />
                      ) : null}
                    </div>
                    <span className="truncate text-xs text-hub-ink-muted">
                      {tile.status === "error"
                        ? (tile.message ?? MEDIA_COPY.errLoad)
                        : tile.status === "queued"
                          ? "Waiting…"
                          : `Uploading ${Math.round(tile.pct)}%`}
                    </span>
                    {tile.status === "error" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => uploads.remove(tile.key)}
                      >
                        Dismiss
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : null}
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {live}
        </p>

        {current ? (
          <PhotoPanel
            key={current.id}
            uid={uid}
            image={current}
            index={selIndex}
            info={known.get(current.asset)}
            hasNextAmber={nextNeedingDescription(images, selIndex) >= 0}
            hereOnly={hereOnly.has(current.id)}
            onAlt={(alt) =>
              patch(current.id, {
                alt: alt.slice(0, GALLERY_LIMITS.altMax),
                alt_reviewed: true,
              })
            }
            onAltBlur={() => {
              const now = latest.current.find((x) => x.id === current.id);
              if (now) backfill(now);
            }}
            onCaption={(caption) =>
              patch(current.id, {
                caption: caption.slice(0, GALLERY_LIMITS.captionMax),
              })
            }
            onNextAmber={() => openNextAmber(selIndex)}
            onRemove={() => remove(selIndex)}
          />
        ) : null}

        <MediaDropZone
          accept="image/jpeg,image/png,image/webp"
          prompt="Drop photos here, or"
          chooseLabel="choose from your media"
          disabled={atMax}
          onChoose={() => setPickerOpen(true)}
          onFiles={(files) => {
            const room = GALLERY_LIMITS.maxImages - latest.current.length;
            if (files.length > room) toast.show({ message: GALLERY_MAX_COPY });
            if (room > 0) uploads.add(files.slice(0, room));
          }}
        />
        {errors.images ? (
          <p role="alert" className="text-sm font-semibold text-hub-danger">
            {errors.images}
          </p>
        ) : null}
      </section>

      <MediaPicker
        open={pickerOpen}
        kind="image"
        multiple
        onUse={(picked) => {
          setPickerOpen(false);
          append(picked);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

interface ThumbProps {
  id: string;
  index: number;
  count: number;
  info: GalleryThumbInfo | undefined;
  loading: boolean;
  amber: boolean;
  selected: boolean;
  name: string;
  onOpen: () => void;
  onMove: (dir: -1 | 1) => void;
}

function SortableThumb({
  id,
  index,
  count,
  info,
  loading,
  amber,
  selected,
  name,
  onOpen,
  onMove,
}: ThumbProps) {
  const reduced = useReducedMotion();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: { type: "item" },
    transition: reduced ? null : undefined,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
  };
  const n = index + 1;

  let picture: ReactNode;
  if (loading) {
    picture = (
      <span
        aria-hidden="true"
        data-skeleton-row=""
        className="block size-full animate-pulse bg-hub-surface-2 motion-reduce:animate-none"
      />
    );
  } else if (info?.thumbUrl && !info.deleted) {
    picture = (
      <img src={info.thumbUrl} alt="" className="size-full object-cover" />
    );
  } else {
    picture = (
      <span aria-hidden="true" className="block size-full bg-hub-surface-2" />
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-gallery-thumb={id}
      className={`flex w-24 flex-col gap-1 ${liftClasses(isDragging)}`}
    >
      <button
        type="button"
        aria-label={name}
        aria-expanded={selected}
        onClick={onOpen}
        className={
          "relative size-24 overflow-hidden rounded border bg-hub-surface " +
          (selected
            ? "border-2 border-hub-accent "
            : "border-hub-border hover:border-hub-ink-muted ") +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
        }
      >
        {picture}
        {info?.deleted ? (
          <span className="absolute inset-x-0 bottom-0 bg-hub-surface/90 px-1 py-0.5 text-left text-xs leading-tight text-hub-ink">
            {MEDIA_COPY.deletedField}
          </span>
        ) : null}
      </button>
      {amber ? (
        <Badge tone="needs-description" className="self-start text-xs">
          Needs description
        </Badge>
      ) : null}
      <div className="flex flex-wrap items-center">
        <IconButton
          {...attributes}
          {...listeners}
          size="sm"
          tooltipAlign="start"
          label={`Reorder photo ${n}`}
          icon={<GripVertical aria-hidden size={16} strokeWidth={2} />}
          className="cursor-grab touch-none active:cursor-grabbing"
        />
        <IconButton
          size="sm"
          label={`Move photo ${n} earlier`}
          icon={<ChevronLeft aria-hidden size={16} strokeWidth={2} />}
          aria-disabled={index === 0 || undefined}
          onClick={() => onMove(-1)}
        />
        <IconButton
          size="sm"
          tooltipAlign="end"
          label={`Move photo ${n} later`}
          icon={<ChevronRight aria-hidden size={16} strokeWidth={2} />}
          aria-disabled={index === count - 1 || undefined}
          onClick={() => onMove(1)}
        />
      </div>
    </li>
  );
}

interface PanelProps {
  uid: string;
  image: GalleryImage;
  index: number;
  info: GalleryThumbInfo | undefined;
  hasNextAmber: boolean;
  hereOnly: boolean;
  onAlt: (alt: string) => void;
  onAltBlur: () => void;
  onCaption: (caption: string) => void;
  onNextAmber: () => void;
  onRemove: () => void;
}

function PhotoPanel({
  uid,
  image,
  index,
  info,
  hasNextAmber,
  hereOnly,
  onAlt,
  onAltBlur,
  onCaption,
  onNextAmber,
  onRemove,
}: PanelProps) {
  const alt = image.alt || info?.alt || "";
  return (
    <div
      data-gallery-panel=""
      role="group"
      aria-label={`Photo ${index + 1}`}
      className="flex flex-col gap-4 rounded border border-hub-border bg-hub-surface-2 p-4 md:flex-row"
    >
      <div className="w-full shrink-0 md:w-60">
        {info?.thumbUrl && !info.deleted ? (
          <img
            src={info.thumbUrl}
            alt=""
            className="max-h-60 w-full rounded object-contain"
          />
        ) : (
          <div className="flex h-40 items-center justify-center rounded bg-hub-surface text-sm text-hub-ink-muted">
            {info?.deleted ? MEDIA_COPY.deletedField : "…"}
          </div>
        )}
        {info?.name ? (
          <p
            className="mt-2 truncate text-sm text-hub-ink-muted"
            title={info.name}
          >
            {info.name}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <TextArea
          id={`${uid}-alt`}
          label="Description"
          rows={2}
          required
          maxLength={GALLERY_LIMITS.altMax}
          counter={{ value: alt.length, max: GALLERY_LIMITS.altMax }}
          helper={
            hereOnly
              ? `${GALLERY_DESCRIPTION_HELPER} ${GALLERY_SAVED_HERE_ONLY}`
              : GALLERY_DESCRIPTION_HELPER
          }
          labelExtra={
            image.alt_reviewed ? null : (
              <Badge tone="needs-description">Needs description</Badge>
            )
          }
          value={alt}
          onChange={(e) => onAlt(e.currentTarget.value)}
          onBlur={onAltBlur}
        />
        <TextField
          id={`${uid}-caption`}
          label="Caption"
          labelExtra={
            <span className="text-sm text-hub-ink-muted">Optional</span>
          }
          maxLength={GALLERY_LIMITS.captionMax}
          counter={{
            value: image.caption.length,
            max: GALLERY_LIMITS.captionMax,
          }}
          value={image.caption}
          onChange={(e) => onCaption(e.currentTarget.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          {hasNextAmber ? (
            <Button variant="secondary" size="sm" onClick={onNextAmber}>
              Next photo that needs a description
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 aria-hidden size={16} strokeWidth={2} />}
            onClick={onRemove}
            className="hover:text-hub-danger"
          >
            Remove from gallery
          </Button>
        </div>
      </div>
    </div>
  );
}
