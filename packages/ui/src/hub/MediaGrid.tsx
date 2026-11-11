"use client";
// MediaGrid: the media library grid and the picker's listbox (07-17; CONT-21, D-UI-P7-4/10;
// 07-UI-SPEC "Grid", "Interaction states", "Accessibility contract", "Responsive contract").
// 16px gap, square tiles of at least 160px (2 columns below 768px). Upload tiles come first,
// then the files, newest first. 12 skeleton tiles while loading; EMPTY-MEDIA (drop zone +
// Upload files) when the library is empty; the filtered empty line + Clear filters when a
// search or filter hides everything; Load more at the end (no infinite scroll).
// Picker mode (`selectable`): role="listbox" (aria-multiselectable for multi), options with
// aria-selected, a roving tabindex, arrow keys by the rendered column count, Home/End, and
// Space/Enter to toggle.
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { EmptyState } from "./feedback";
import { MediaDropZone } from "./MediaDropZone";
import { MediaTile } from "./MediaTile";
import { MEDIA_COPY, type LibraryItemView } from "./media/copy";
import type { UploadTileView } from "./useMediaUploads";

export interface MediaGridProps {
  items: readonly LibraryItemView[];
  uploads?: readonly UploadTileView[];
  loading?: boolean;
  /** A search or filter is set (the filtered empty state). */
  filtered?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  canWrite?: boolean;
  onLoadMore?(): void;
  onOpen?(id: string): void;
  onRetry?(id: string): void;
  onRemove?(id: string): void;
  onStop?(key: string): void;
  onRemoveUpload?(key: string): void;
  onClearFilters?(): void;
  onFiles?(files: File[]): void;
  /** Replaces the default empty state (the picker's kind line). */
  empty?: ReactNode;
  /** The EMPTY-MEDIA action (drop zone + Upload files); default: the drop zone alone. */
  emptyAction?: ReactNode;
  selectable?: "single" | "multi";
  selectedIds?: readonly string[];
  onToggle?(id: string): void;
  /** Accessible name of the listbox in picker mode. */
  label?: string;
  busy?: boolean;
}

const GRID =
  "grid grid-cols-2 gap-4 md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]";

/** How many options share the first option's row (the rendered column count). */
function columnsOf(list: HTMLElement | null): number {
  if (!list) return 1;
  const opts = Array.from(
    list.querySelectorAll<HTMLElement>('[role="option"]'),
  );
  if (opts.length === 0) return 1;
  const top = opts[0]!.offsetTop;
  const n = opts.filter((o) => o.offsetTop === top).length;
  return Math.max(1, n);
}

export function MediaGrid({
  items,
  uploads = [],
  loading = false,
  filtered = false,
  hasMore = false,
  loadingMore = false,
  canWrite = false,
  onLoadMore,
  onOpen,
  onRetry,
  onRemove,
  onStop,
  onRemoveUpload,
  onClearFilters,
  onFiles,
  empty,
  emptyAction,
  selectable,
  selectedIds = [],
  onToggle,
  label = "Your media",
  busy = false,
}: MediaGridProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));

  if (loading) {
    return (
      <ul aria-hidden="true" className={GRID} data-media-loading="">
        {Array.from({ length: 12 }, (_, i) => (
          <li
            key={i}
            data-skeleton-tile=""
            className="aspect-square animate-pulse rounded bg-hub-surface-2 motion-reduce:animate-none"
          />
        ))}
      </ul>
    );
  }

  if (items.length === 0 && uploads.length === 0) {
    if (empty) return <>{empty}</>;
    if (filtered) {
      return (
        <div className="flex flex-col items-start gap-2 py-8 font-hub">
          <p className="text-base text-hub-ink-muted">
            {MEDIA_COPY.filteredEmpty}
          </p>
          {onClearFilters ? (
            <Button variant="ghost" onClick={onClearFilters}>
              {MEDIA_COPY.clearFilters}
            </Button>
          ) : null}
        </div>
      );
    }
    return (
      <EmptyState
        heading={MEDIA_COPY.emptyHeading}
        body={MEDIA_COPY.emptyBody}
        action={
          !canWrite
            ? undefined
            : (emptyAction ??
              (onFiles ? <MediaDropZone onFiles={onFiles} /> : undefined))
        }
      />
    );
  }

  function focusAt(i: number) {
    const opts =
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    if (!opts || opts.length === 0) return;
    const next = Math.max(0, Math.min(opts.length - 1, i));
    setActive(next);
    opts[next]?.focus();
  }

  function onOptionKeyDown(e: KeyboardEvent<HTMLLIElement>, id: string) {
    const i = items.findIndex((it) => it.id === id);
    const cols = columnsOf(listRef.current);
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        focusAt(i + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusAt(i - 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusAt(i + cols);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(i - cols);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(items.length - 1);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        onToggle?.(id);
        break;
      default:
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {selectable && uploads.length > 0 ? (
        <ul className={GRID}>
          {uploads.map((u) => (
            <MediaTile
              key={u.key}
              upload={u}
              onStop={onStop}
              onRemove={onRemoveUpload}
            />
          ))}
        </ul>
      ) : null}
      <ul
        ref={listRef}
        className={`${GRID} ${busy ? "opacity-60" : ""}`}
        aria-busy={busy || undefined}
        {...(selectable
          ? {
              role: "listbox",
              "aria-label": label,
              "aria-multiselectable": selectable === "multi" ? true : undefined,
            }
          : {})}
      >
        {!selectable
          ? uploads.map((u) => (
              <MediaTile
                key={u.key}
                upload={u}
                onStop={onStop}
                onRemove={onRemoveUpload}
              />
            ))
          : null}
        {items.map((item, i) => (
          <MediaTile
            key={item.id}
            item={item}
            canWrite={canWrite}
            onOpen={onOpen}
            onRetry={onRetry}
            onRemove={onRemove}
            {...(selectable
              ? {
                  selectable: true,
                  selected: selectedIds.includes(item.id),
                  tabIndex: i === activeIndex ? 0 : -1,
                  onToggle: (id: string) => {
                    setActive(i);
                    onToggle?.(id);
                  },
                  onOptionKeyDown,
                }
              : {})}
          />
        ))}
      </ul>
      {hasMore && onLoadMore ? (
        <div>
          <Button
            variant="secondary"
            onClick={onLoadMore}
            loading={loadingMore}
            loadingLabel="Loading…"
          >
            {MEDIA_COPY.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
