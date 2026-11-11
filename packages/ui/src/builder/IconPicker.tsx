"use client";
// IconPicker (07-21; CONT-27, CONTEXT decision 5; 07-UI-SPEC "Icon list" row 363 and the
// Accessibility contract line 686: "IconPicker is a listbox with type-ahead search; every
// IconButton names its target"). Plan decision 6: an inline disclosure panel below the
// trigger (the builder's Add item menu pattern: no floating layer to position or trap).
//
// Trigger (44px) shows the current icon, named "Icon: Check. Change icon", aria-expanded.
// The panel holds a search field ("Search icons", matched on the label and the id) and a
// grid listbox (aria-activedescendant focus model) of 44px options from the one static
// ICON_LIST_COMPONENTS map shared with the site renderer. Keys on the listbox: arrows move
// by one and by one row of the current column count, Home/End, Enter/Space select and
// close (focus back on the trigger), a printable key jumps to the search field; Escape
// anywhere closes and refocuses the trigger. Hub tokens only.
import { ICON_LIST_ICON_IDS, type IconListIconId } from "@cds/core/content";
import { Search } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ICON_LIST_COMPONENTS,
  iconListComponent,
  iconListLabel,
} from "../site/blocks/icon-list-icons";

export interface IconPickerProps {
  id: string;
  value: IconListIconId;
  onChange: (id: IconListIconId) => void;
}

export const ICON_PICKER_EMPTY = "No icons match. Try another word.";
/** Column count when layout cannot be measured (jsdom, hidden). */
const DEFAULT_COLS = 8;

export function iconMatches(query: string): IconListIconId[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...ICON_LIST_ICON_IDS];
  return ICON_LIST_ICON_IDS.filter(
    (id) => iconListLabel(id).toLowerCase().includes(q) || id.includes(q),
  );
}

export function IconPicker({ id, value, onChange }: IconPickerProps) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const matches = useMemo(() => iconMatches(query), [query]);
  const Current = iconListComponent(value);
  const currentLabel = iconListLabel(
    Object.prototype.hasOwnProperty.call(ICON_LIST_COMPONENTS, value)
      ? value
      : "check",
  );
  const panelId = `${uid}-panel`;
  const optionId = (icon: string) => `${uid}-opt-${icon}`;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  function openPanel() {
    setQuery("");
    const i = ICON_LIST_ICON_IDS.indexOf(value);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  function close() {
    setOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function select(icon: IconListIconId) {
    onChange(icon);
    close();
  }

  function columnsNow(): number {
    const opts =
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    if (!opts || opts.length < 2) return DEFAULT_COLS;
    const top = opts[0]!.getBoundingClientRect().top;
    let n = 0;
    for (const o of Array.from(opts)) {
      if (o.getBoundingClientRect().top !== top) break;
      n += 1;
    }
    return n > 0 && n < opts.length ? n : DEFAULT_COLS;
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    const last = matches.length - 1;
    if (last < 0) return;
    const cols = columnsNow();
    let next = activeIndex;
    switch (e.key) {
      case "ArrowRight":
        next = Math.min(last, activeIndex + 1);
        break;
      case "ArrowLeft":
        next = Math.max(0, activeIndex - 1);
        break;
      case "ArrowDown":
        next = Math.min(last, activeIndex + cols);
        break;
      case "ArrowUp":
        next = Math.max(0, activeIndex - cols);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        select(matches[activeIndex]!);
        return;
      default:
        // Type-ahead: a printable key continues in the search field.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setQuery((q) => q + e.key);
          setActive(0);
          searchRef.current?.focus();
        }
        return;
    }
    e.preventDefault();
    setActive(next);
    document
      .getElementById(optionId(matches[next]!))
      ?.scrollIntoView?.({ block: "nearest" });
  }

  return (
    <div
      className="flex flex-col gap-2 font-hub"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <span className="text-sm font-semibold text-hub-ink" id={`${uid}-label`}>
        Icon
      </span>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-label={`Icon: ${currentLabel}. Change icon`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : openPanel())}
        className={
          "inline-flex h-11 w-11 items-center justify-center rounded border " +
          "border-hub-border-strong bg-hub-surface text-hub-ink transition-colors " +
          "duration-150 hover:bg-hub-surface-2"
        }
      >
        <Current aria-hidden size={20} strokeWidth={2} />
      </button>
      {open ? (
        <div
          id={panelId}
          className="flex flex-col gap-3 rounded border border-hub-border bg-hub-surface p-3"
        >
          <label className="flex flex-col gap-2" htmlFor={`${uid}-search`}>
            <span className="text-sm font-semibold text-hub-ink">
              Search icons
            </span>
            <span className="relative">
              <Search
                aria-hidden
                size={16}
                strokeWidth={2}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-hub-ink-muted"
              />
              <input
                ref={searchRef}
                id={`${uid}-search`}
                type="search"
                value={query}
                autoComplete="off"
                aria-controls={`${uid}-list`}
                onChange={(e) => {
                  setQuery(e.currentTarget.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "Enter") {
                    e.preventDefault();
                    if (e.key === "Enter" && matches.length === 1) {
                      select(matches[0]!);
                      return;
                    }
                    listRef.current?.focus();
                  }
                }}
                className={
                  "h-10 w-full rounded border border-hub-border-strong bg-hub-surface pr-3 pl-9 " +
                  "font-hub text-base text-hub-ink placeholder:text-hub-ink-muted"
                }
                placeholder="Like phone, star or heart"
              />
            </span>
          </label>
          {matches.length === 0 ? (
            <p role="status" className="text-sm text-hub-ink-muted">
              {ICON_PICKER_EMPTY}
            </p>
          ) : null}
          <div
            ref={listRef}
            id={`${uid}-list`}
            role="listbox"
            aria-label="Icons"
            tabIndex={0}
            aria-activedescendant={
              matches.length > 0 ? optionId(matches[activeIndex]!) : undefined
            }
            onKeyDown={onListKey}
            className={
              "grid max-h-72 grid-cols-[repeat(auto-fill,44px)] gap-1 overflow-y-auto rounded p-1 " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent " +
              (matches.length === 0 ? "hidden" : "")
            }
          >
            {matches.map((icon, i) => {
              const Icon = ICON_LIST_COMPONENTS[icon];
              const name = iconListLabel(icon);
              const selected = icon === value;
              const isActive = i === activeIndex;
              return (
                <div
                  key={icon}
                  id={optionId(icon)}
                  role="option"
                  aria-selected={selected}
                  aria-label={name}
                  title={name}
                  data-icon={icon}
                  onClick={() => select(icon)}
                  onMouseMove={() => setActive(i)}
                  className={
                    "flex h-11 w-11 cursor-pointer items-center justify-center rounded text-hub-ink " +
                    "transition-colors duration-150 hover:bg-hub-surface-2 " +
                    (isActive
                      ? "bg-hub-surface-2 outline outline-1 outline-hub-border-strong "
                      : "") +
                    (selected ? "ring-2 ring-hub-accent" : "")
                  }
                >
                  <Icon aria-hidden size={20} strokeWidth={2} />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
