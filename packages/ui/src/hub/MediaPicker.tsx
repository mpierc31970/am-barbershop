"use client";
// MediaPicker: choose-and-return over a form the owner must not lose (07-17; CONT-14,
// CONT-19, CONT-21, D-UI-P7-5/9/10/11; 07-UI-SPEC "Media picker", "Interaction states",
// "Accessibility contract"). 07-30 (CONT-28, D-UI-P7-11, choices 9, 10): a Free photos tab for a
// single photo when `allowStock` is set and the stock source answers available; absent otherwise.
// Its own native <dialog> (useModalDialog: focus trap, Esc, focus return), at most 960px wide,
// full screen below 768px. Title by kind ("Choose a photo" / "Choose photos" / "Choose a
// video" / "Choose audio"); tab buttons Your media · Upload.
//   Your media: the library filtered to the kind, with search, as a listbox (single or
//     multi). Soft-deleted files never appear (the list never returns them).
//   Upload: a drop zone + the upload states, restricted to the kind; finished files are
//     fetched with source.items and selected. At 100% of the allowance: USAGE-FULL instead.
//   Single photo without a description: a Description strip above the footer; Use this photo
//     stays disabled until source.describe saves it (D-UI-P7-5). Multi-select never blocks on
//     descriptions (choice 6); each pick carries needsDescription.
//   Free photos: search (400 ms debounce, Enter searches now), a listbox of results with a
//     "Photo by <name>" credit, Load more; a pick shows the Description strip prefilled with
//     the photo's alt (required). Use this photo pings the source (failure ignored) and returns
//     a PickedMedia with id "" and `stock` (stored by URL, never counted toward 2 GB).
// Data only through the injected MediaSource (default fetchMediaSource, choice 1) and
// StockSourceClient (default fetchStockSource).
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { InlineAlert } from "./feedback";
import { TextField } from "./fields";
import { MediaDropZone } from "./MediaDropZone";
import { MediaGrid } from "./MediaGrid";
import {
  MEDIA_COPY,
  MEDIA_PAGE_SIZE,
  kindFilter,
  photoByLabel,
  pickedOf,
  pickedOfStock,
  pickerEmpty,
  pickerTitle,
  selectedCount,
  pickerUseLabel,
  type LibraryItemView,
  type MediaKind,
  type PickedMedia,
  type StockPhotoView,
  type UsageView,
} from "./media/copy";
import { fetchMediaSource, type MediaSource } from "./media/source";
import { fetchStockSource, type StockSourceClient } from "./media/stock-source";
import { useMediaUploads, type MediaUploader } from "./useMediaUploads";
import { useModalDialog } from "./useModalDialog";

export interface MediaPickerProps {
  open: boolean;
  kind: MediaKind;
  multiple?: boolean;
  source?: MediaSource;
  /** Test seam for the Upload tab. */
  uploader?: MediaUploader;
  /** 07-30: offer Free photos (single image only, and only when the source is available). */
  allowStock?: boolean;
  /** 07-30: test seam for Free photos (default fetchStockSource). */
  stock?: StockSourceClient;
  onUse(picked: PickedMedia[]): void;
  onClose(): void;
}

const ACCEPT: Record<MediaKind, string> = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4",
  audio: "audio/mpeg",
};

type Tab = "library" | "upload" | "stock";

const STOCK_DEBOUNCE_MS = 400;

function Panel({
  kind,
  multiple = false,
  source = fetchMediaSource,
  uploader,
  allowStock = false,
  stock = fetchStockSource,
  onUse,
  onClose,
  titleId,
}: MediaPickerProps & { titleId: string }) {
  const searchId = useId();
  const altId = useId();
  const stockSearchId = useId();
  const stockAltId = useId();
  const stockAllowed = allowStock && kind === "image" && !multiple;
  const [stockOn, setStockOn] = useState(false);
  const [stockQ, setStockQ] = useState("");
  const [stockRun, setStockRun] = useState({ q: "", n: 0 });
  const [stockPhotos, setStockPhotos] = useState<StockPhotoView[]>([]);
  const [stockPage, setStockPage] = useState(1);
  const [stockHasMore, setStockHasMore] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockPick, setStockPick] = useState<StockPhotoView | null>(null);
  const [stockAlt, setStockAlt] = useState("");
  const [stockAltError, setStockAltError] = useState<string | null>(null);
  const stockRequest = useRef(0);
  const [tab, setTab] = useState<Tab>("library");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LibraryItemView[]>([]);
  const [uploaded, setUploaded] = useState<LibraryItemView[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [selected, setSelected] = useState<LibraryItemView[]>([]);
  const [alt, setAlt] = useState("");
  const [altError, setAltError] = useState<string | null>(null);
  const [describing, setDescribing] = useState(false);
  const request = useRef(0);
  const filter = kindFilter(kind);

  // Load page 1 on open and after the search settles (300ms).
  useEffect(() => {
    const n = ++request.current;
    const t = setTimeout(
      () => {
        void source
          .list({ filter, q, page: 1, perPage: MEDIA_PAGE_SIZE })
          .then((res) => {
            if (n !== request.current) return;
            setLoading(false);
            if (!res.ok) {
              setError(res.message);
              setItems([]);
              return;
            }
            setError(null);
            setItems(res.data.page.items);
            setPage(1);
            setHasMore(
              res.data.page.page * res.data.page.perPage < res.data.page.total,
            );
            setUsage(res.data.usage);
          });
      },
      q === "" ? 0 : 300,
    );
    return () => clearTimeout(t);
  }, [source, filter, q]);

  // 07-30: ask once whether Free photos exist; the tab never shows before a yes.
  useEffect(() => {
    if (!stockAllowed) return;
    let live = true;
    void stock.available().then((yes) => {
      if (live) setStockOn(yes === true);
    });
    return () => {
      live = false;
    };
  }, [stock, stockAllowed]);

  // Debounce typing; Enter runs at once (bumps n).
  useEffect(() => {
    const q = stockQ.trim();
    if (q === stockRun.q) return;
    const t = setTimeout(
      () => setStockRun((r) => ({ q, n: r.n + 1 })),
      STOCK_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [stockQ, stockRun.q]);

  useEffect(() => {
    if (stockRun.n === 0) return;
    const n = ++stockRequest.current;
    if (stockRun.q === "") {
      setStockPhotos([]);
      setStockHasMore(false);
      setStockError(null);
      // A search still in flight is now ignored, so it can't clear this (WR-E06).
      setStockLoading(false);
      return;
    }
    setStockLoading(true);
    void stock.search(stockRun.q, 1).then((res) => {
      if (n !== stockRequest.current) return;
      setStockLoading(false);
      if (!res.ok) {
        setStockError(res.message);
        setStockPhotos([]);
        return;
      }
      setStockError(null);
      setStockPhotos([...res.data.photos]);
      setStockPage(1);
      setStockHasMore(res.data.hasMore);
    });
  }, [stock, stockRun]);

  async function loadMoreStock() {
    const n = ++stockRequest.current;
    setStockLoading(true);
    const res = await stock.search(stockRun.q, stockPage + 1);
    if (n !== stockRequest.current) return;
    setStockLoading(false);
    if (!res.ok) {
      setStockError(res.message);
      return;
    }
    setStockPhotos((list) => [
      ...list,
      ...res.data.photos.filter((p) => !list.some((x) => x.id === p.id)),
    ]);
    setStockPage((p) => p + 1);
    setStockHasMore(res.data.hasMore);
  }

  function pickStock(photo: StockPhotoView) {
    setSelected([]);
    setStockAltError(null);
    if (stockPick?.id === photo.id) {
      setStockPick(null);
      return;
    }
    setStockPick(photo);
    setStockAlt(photo.alt);
  }

  async function loadMore() {
    // Not bumped here: a new search bumps it, so an older page is dropped (WR-E05).
    const n = request.current;
    setLoadingMore(true);
    const res = await source.list({
      filter,
      q,
      page: page + 1,
      perPage: MEDIA_PAGE_SIZE,
    });
    setLoadingMore(false);
    if (n !== request.current) return;
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setItems((list) => [
      ...list,
      ...res.data.page.items.filter((i) => !list.some((x) => x.id === i.id)),
    ]);
    setPage(res.data.page.page);
    setHasMore(
      res.data.page.page * res.data.page.perPage < res.data.page.total,
    );
  }

  function select(item: LibraryItemView, add = false) {
    setAltError(null);
    if (multiple) {
      setSelected((list) =>
        list.some((x) => x.id === item.id)
          ? add
            ? list
            : list.filter((x) => x.id !== item.id)
          : [...list, item],
      );
      return;
    }
    setSelected((list) => (list[0]?.id === item.id && !add ? [] : [item]));
    setAlt("");
    setStockPick(null);
  }

  function toggle(id: string) {
    const item =
      items.find((i) => i.id === id) ?? uploaded.find((i) => i.id === id);
    if (item) select(item);
  }

  const uploads = useMediaUploads({
    kinds: [kind],
    ...(uploader ? { uploader } : {}),
    onUploaded: (assetId) => {
      void source.items([assetId]).then((res) => {
        if (!res.ok) return;
        const fresh = res.data.filter((i) => !i.deleted);
        setUploaded((list) => [...fresh, ...list]);
        setItems((list) => [
          ...fresh,
          ...list.filter((x) => !fresh.some((f) => f.id === x.id)),
        ]);
        for (const f of fresh) select(f, true);
      });
    },
  });

  const single = !multiple ? selected[0] : undefined;
  const blocked =
    single !== undefined && single.kind === "image" && single.alt.trim() === "";
  const usingStock = stockPick !== null && selected.length === 0;
  const canUse = usingStock || (selected.length > 0 && !blocked);

  async function saveDescription() {
    if (!single) return;
    const v = alt.trim();
    if (v === "") {
      setAltError(MEDIA_COPY.altMissing);
      return;
    }
    setDescribing(true);
    const res = await source.describe([{ id: single.id, alt: v }]);
    setDescribing(false);
    if (!res.ok) {
      setAltError(res.message);
      return;
    }
    setAltError(null);
    const patch = (i: LibraryItemView) =>
      i.id === single.id ? { ...i, alt: v, needsDescription: false } : i;
    setItems((list) => list.map(patch));
    setUploaded((list) => list.map(patch));
    setSelected((list) => list.map(patch));
  }

  function use() {
    if (!canUse) return;
    if (usingStock && stockPick) {
      const description = stockAlt.trim();
      if (description === "") {
        setStockAltError(MEDIA_COPY.altMissing);
        return;
      }
      void stock.use(stockPick.id);
      onUse([pickedOfStock(stockPick, description)]);
      onClose();
      return;
    }
    onUse(selected.map(pickedOf));
    onClose();
  }

  const selectedIds = selected.map((s) => s.id);
  const full = usage?.level === "full";
  const tabClass = (active: boolean) =>
    "min-h-11 border-b-2 px-3 text-sm font-semibold transition-colors duration-150 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent " +
    (active
      ? "border-hub-accent text-hub-ink"
      : "border-transparent text-hub-ink-muted hover:text-hub-ink");

  return (
    <div className="flex h-full max-h-[inherit] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
        <h2 id={titleId} className="text-xl leading-tight font-semibold">
          {pickerTitle(kind, multiple)}
        </h2>
        <IconButton
          label="Close"
          tooltipAlign="end"
          onClick={onClose}
          icon={<X aria-hidden size={20} strokeWidth={2} />}
        />
      </div>
      <div
        role="tablist"
        aria-label="Where from"
        className="flex gap-2 border-b border-hub-border px-6"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "library"}
          className={tabClass(tab === "library")}
          onClick={() => setTab("library")}
        >
          {MEDIA_COPY.yourMedia}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "upload"}
          className={tabClass(tab === "upload")}
          onClick={() => setTab("upload")}
        >
          {MEDIA_COPY.upload}
        </button>
        {stockAllowed && stockOn ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "stock"}
            className={tabClass(tab === "stock")}
            onClick={() => setTab("stock")}
          >
            {MEDIA_COPY.freePhotos}
          </button>
        ) : null}
      </div>
      <div role="tabpanel" className="flex-1 overflow-y-auto px-6 py-6">
        {tab === "stock" ? (
          <div className="flex flex-col gap-4" data-stock-panel="">
            <div className="md:max-w-sm">
              <TextField
                id={stockSearchId}
                type="search"
                label={MEDIA_COPY.stockSearchLabel}
                helper={MEDIA_COPY.stockHint}
                value={stockQ}
                maxLength={100}
                onChange={(e) => setStockQ(e.currentTarget.value)}
                onKeyDown={(e) => {
                  // The picker can sit inside a builder <form>: never submit it.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setStockRun((r) => ({ q: stockQ.trim(), n: r.n + 1 }));
                  }
                }}
              />
            </div>
            {stockError ? (
              <InlineAlert tone="error">{stockError}</InlineAlert>
            ) : stockRun.q !== "" &&
              !stockLoading &&
              stockPhotos.length === 0 ? (
              <p className="py-8 text-base text-hub-ink-muted">
                {MEDIA_COPY.stockEmpty}
              </p>
            ) : (
              <ul
                role="listbox"
                aria-label={MEDIA_COPY.freePhotos}
                aria-busy={stockLoading || undefined}
                className="grid grid-cols-2 gap-4 md:grid-cols-4"
              >
                {stockPhotos.map((photo) => {
                  const on = stockPick?.id === photo.id;
                  return (
                    <li
                      key={photo.id}
                      role="option"
                      aria-selected={on}
                      tabIndex={0}
                      data-stock-tile={photo.id}
                      onClick={() => pickStock(photo)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          pickStock(photo);
                        }
                      }}
                      className={
                        "flex cursor-pointer flex-col gap-1 rounded p-1 outline-offset-2 " +
                        "focus-visible:outline-2 focus-visible:outline-hub-accent " +
                        (on ? "ring-2 ring-hub-accent" : "")
                      }
                    >
                      <img
                        src={photo.thumbUrl}
                        alt={photo.alt}
                        loading="lazy"
                        className="aspect-[4/3] w-full rounded bg-hub-surface-2 object-cover"
                      />
                      <span className="truncate text-sm text-hub-ink-muted">
                        {photoByLabel(photo.creditName)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {stockHasMore && !stockError ? (
              <div>
                <Button
                  variant="secondary"
                  loading={stockLoading}
                  loadingLabel="Loading…"
                  onClick={() => void loadMoreStock()}
                >
                  {MEDIA_COPY.loadMore}
                </Button>
              </div>
            ) : null}
          </div>
        ) : tab === "library" ? (
          <div className="flex flex-col gap-4">
            <div className="md:max-w-xs">
              <TextField
                id={searchId}
                type="search"
                label={MEDIA_COPY.searchLabel}
                value={q}
                maxLength={100}
                onChange={(e) => setQ(e.currentTarget.value)}
                onKeyDown={(e) => {
                  // The picker can sit inside a builder <form>: never submit it.
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
            </div>
            {error ? (
              <InlineAlert tone="error">{error}</InlineAlert>
            ) : (
              <MediaGrid
                items={items}
                loading={loading}
                filtered={q.trim() !== ""}
                hasMore={hasMore}
                loadingMore={loadingMore}
                onLoadMore={() => void loadMore()}
                onClearFilters={() => setQ("")}
                empty={
                  q.trim() === "" ? (
                    <p className="py-8 text-base text-hub-ink-muted">
                      {pickerEmpty(kind)}
                    </p>
                  ) : undefined
                }
                selectable={multiple ? "multi" : "single"}
                selectedIds={selectedIds}
                onToggle={toggle}
                label={pickerTitle(kind, multiple)}
              />
            )}
          </div>
        ) : full ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-hub-ink-muted" data-usage-full="">
              {usage?.message || MEDIA_COPY.usageFull}
            </p>
            {/* 10-43 (D-UI-P10-18): a link only, never a purchase inside a picker. */}
            {usage?.storageHref ? (
              <a
                href={usage.storageHref}
                data-add-storage=""
                className="text-sm font-semibold text-hub-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
              >
                {MEDIA_COPY.addStorage}
              </a>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <MediaDropZone
              accept={ACCEPT[kind]}
              multiple={multiple}
              onFiles={(files) => uploads.add(files)}
            />
            {uploads.tiles.length > 0 || uploaded.length > 0 ? (
              <MediaGrid
                items={uploaded}
                uploads={uploads.tiles}
                onStop={uploads.stop}
                onRemoveUpload={uploads.remove}
                selectable={multiple ? "multi" : "single"}
                selectedIds={selectedIds}
                onToggle={toggle}
                label={MEDIA_COPY.upload}
              />
            ) : null}
          </div>
        )}
      </div>
      {usingStock && stockPick ? (
        <div
          className="flex flex-col gap-2 border-t border-hub-border bg-hub-surface-2 px-6 py-4"
          data-describe-strip="stock"
        >
          <TextField
            id={stockAltId}
            label={MEDIA_COPY.descriptionLabel}
            helper={MEDIA_COPY.altHelper}
            error={stockAltError ?? undefined}
            required
            maxLength={250}
            value={stockAlt}
            onChange={(e) => {
              setStockAlt(e.currentTarget.value);
              setStockAltError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
        </div>
      ) : null}
      {blocked ? (
        <div
          className="flex flex-col gap-2 border-t border-hub-border bg-hub-surface-2 px-6 py-4 md:flex-row md:items-start"
          data-describe-strip=""
        >
          <div className="flex-1">
            <TextField
              id={altId}
              label={`Description of ${single.name}`}
              helper={MEDIA_COPY.altHelper}
              error={altError ?? undefined}
              required
              maxLength={250}
              value={alt}
              onChange={(e) => setAlt(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveDescription();
                }
              }}
            />
          </div>
          <Button
            variant="secondary"
            className="md:mt-7"
            loading={describing}
            loadingLabel="Saving…"
            onClick={() => void saveDescription()}
          >
            {MEDIA_COPY.saveDescription}
          </Button>
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-4 border-t border-hub-border px-6 py-4">
        {multiple ? (
          <span
            className="text-sm text-hub-ink-muted tabular-nums"
            aria-live="polite"
          >
            {selectedCount(selected.length)}
          </span>
        ) : null}
        <Button variant="primary" disabled={!canUse} onClick={use}>
          {pickerUseLabel(kind, Math.max(1, selected.length))}
        </Button>
      </div>
    </div>
  );
}

export function MediaPicker(props: MediaPickerProps) {
  const { open, onClose } = props;
  const ref = useModalDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-media-picker=""
      className={
        "m-0 h-full max-h-none w-full max-w-none bg-hub-surface p-0 font-hub text-hub-ink " +
        "backdrop:bg-hub-ink/40 md:m-auto md:h-auto md:max-h-[90vh] md:w-[calc(100%-32px)] " +
        "md:max-w-[960px] md:rounded md:shadow-xl"
      }
    >
      {open ? <Panel {...props} titleId={titleId} /> : null}
    </dialog>
  );
}
