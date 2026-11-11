"use client";
// MediaFilters: the Media filter row (07-17; CONT-21, D227, D-UI-P7-4; 07-UI-SPEC "Media"
// filter row). A native radio group styled as the P6 segmented control (ink, never accent):
// All · Images · Videos, plus Audio only when an audio file exists, each with its count; the
// search field "Search by name or description" (300ms debounce, Enter at once); and, only
// when a photo lacks a description, the notice link "12 photos need a description ·
// Describe them". Navigation goes through `onChange` and `LinkComponent` (no next/* import).
import {
  useEffect,
  useId,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ComponentType,
} from "react";
import { TextField } from "./fields";
import {
  MEDIA_COPY,
  describeNotice,
  filterLabel,
  type LibraryCountsView,
  type LibraryFilterView,
} from "./media/copy";

export type MediaFilterPatch = { filter?: LibraryFilterView; q?: string };

export interface MediaFiltersProps {
  filter: LibraryFilterView;
  q: string;
  counts: LibraryCountsView;
  needsDescription: number;
  describeHref: string;
  LinkComponent?: ComponentType<
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
  >;
  onChange(patch: MediaFilterPatch): void;
}

export const SEARCH_DEBOUNCE_MS = 300;

export function MediaFilters({
  filter,
  q,
  counts,
  needsDescription,
  describeHref,
  LinkComponent,
  onChange,
}: MediaFiltersProps) {
  const name = useId();
  const searchId = useId();
  const Link = LinkComponent ?? "a";
  const [text, setText] = useState(q);
  const [seenQ, setSeenQ] = useState(q);
  if (seenQ !== q) {
    setSeenQ(q);
    setText(q);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function commit(value: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = value.trim();
    if (next !== q) onChange({ q: next });
  }

  const filters: LibraryFilterView[] = ["all", "images", "videos"];
  if (counts.audio > 0 || filter === "audio") filters.push("audio");

  return (
    <div className="flex flex-col gap-4 font-hub">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <fieldset className="min-w-0">
          <legend className="sr-only">{MEDIA_COPY.filterLabel}</legend>
          <div className="inline-flex flex-wrap rounded border border-hub-border-strong p-1">
            {filters.map((f) => (
              <label
                key={f}
                className={
                  "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded px-3 text-sm " +
                  "font-semibold text-hub-ink transition-colors duration-150 pointer-coarse:min-h-11 " +
                  "has-checked:bg-hub-ink has-checked:text-hub-surface " +
                  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-hub-accent"
                }
              >
                <input
                  type="radio"
                  name={name}
                  value={f}
                  checked={filter === f}
                  onChange={() => onChange({ filter: f })}
                  className="sr-only"
                />
                {filterLabel(f)}
                <span className="font-normal tabular-nums">
                  {counts[f].toLocaleString("en-US")}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="w-full md:max-w-xs">
          <TextField
            id={searchId}
            type="search"
            label={MEDIA_COPY.searchLabel}
            value={text}
            maxLength={100}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setText(v);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => commit(v), SEARCH_DEBOUNCE_MS);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(e.currentTarget.value);
              }
            }}
          />
        </div>
      </div>
      {needsDescription > 0 ? (
        <p className="text-sm text-hub-ink">
          <Link
            href={describeHref}
            data-describe-link=""
            className="rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
          >
            <strong className="font-semibold">
              {describeNotice(needsDescription)}
            </strong>{" "}
            · {MEDIA_COPY.describeThem}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
