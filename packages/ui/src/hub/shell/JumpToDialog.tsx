"use client";
// Jump to (11-15; DASH-28; 11-UI-SPEC "Jump to", "Accessibility contract"; D-UI-P11-6,
// D-UI-P11-7). A modal command palette on the native <dialog> (useModalDialog: focus
// trap, Esc as `cancel`, focus returns to the opener). Max 560px, 96px from the top at
// >= 640px; a full-width sheet from the top below.
// - Combobox pattern: the input has role="combobox", aria-controls the listbox,
//   aria-activedescendant; ArrowUp/Down move (wrapping), Enter opens, Esc closes. Result
//   rows are 48px: icon 16 + title (matched characters 600) + Label ink-muted path.
// - Groups Screens, then Help articles. The empty query lists the person's Screens in
//   index (sidebar) order; no recent items (D-UI-P11-7), no record search (D311).
// - No match: JUMP-EMPTY with the Help center link. The count is announced politely.
// - The index is server-built and grant-filtered (11-14 and 11-16 validate hub hrefs); this
//   component only filters it and hands the chosen href to onNavigate (T-11-15-01).
// useJumpShortcut binds Ctrl/Cmd+K, except inside a contenteditable (the rich-text editor
// uses Ctrl+K for Link), an input or textarea marked data-own-shortcuts, or while any
// dialog is already open (Pitfall 18, T-11-15-02).
import { CircleHelp, PanelsTopLeft, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useModalDialog } from "../useModalDialog";
import { SHELL_COPY } from "./copy";

/** One palette entry. Same shape as 11-14's buildJumpIndex output (11-16 checks it). */
export interface JumpEntry {
  group: "Screens" | "Help articles";
  label: string;
  href: string;
  /** Extra words that match but are not shown. */
  keywords?: string;
  /** Label line under the title ("Website › Pages", "Help"). */
  path?: string;
}

export const JUMP_MAX_RESULTS = 20;

const GROUP_ORDER: readonly JumpEntry["group"][] = ["Screens", "Help articles"];

function hasWordStart(haystack: string, q: string): boolean {
  let at = haystack.indexOf(q);
  while (at !== -1) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(haystack[at - 1] ?? "")) return true;
    at = haystack.indexOf(q, at + 1);
  }
  return false;
}

function isSubsequence(q: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return i === q.length;
}

/** 0 prefix of the title, 1 word start anywhere, 2 subsequence, null no match. */
function rankEntry(entry: JumpEntry, q: string): number | null {
  const label = entry.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  const haystack = [entry.label, entry.path, entry.keywords]
    .filter((s): s is string => Boolean(s))
    .join(" ")
    .toLowerCase();
  if (hasWordStart(haystack, q)) return 1;
  if (isSubsequence(q, haystack)) return 2;
  return null;
}

/**
 * Filter the Jump to index: case-insensitive match on title, path and keywords, ranked
 * prefix > word start > subsequence (ties keep index order), at most 20. An empty query
 * returns the Screens in index order.
 */
export function filterJumpEntries(
  entries: readonly JumpEntry[],
  query: string,
): JumpEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.filter((e) => e.group === "Screens");
  const scored: { entry: JumpEntry; index: number; rank: number }[] = [];
  entries.forEach((entry, index) => {
    const rank = rankEntry(entry, q);
    if (rank !== null) scored.push({ entry, index, rank });
  });
  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return scored.slice(0, JUMP_MAX_RESULTS).map((s) => s.entry);
}

/**
 * Character positions in `label` to draw at 600: a substring, else a subsequence. Positions
 * are code points, lowercased one at a time, so they line up with `Array.from(label)` in
 * Highlighted even with emoji or a letter whose lowercase is longer (review 11 IN-D01).
 */
export function matchedPositions(label: string, query: string): Set<number> {
  const q = Array.from(query.trim().toLowerCase());
  const out = new Set<number>();
  if (q.length === 0) return out;
  const lower = Array.from(label).map((ch) => ch.toLowerCase());
  for (let at = 0; at + q.length <= lower.length; at += 1) {
    if (q.every((ch, j) => lower[at + j] === ch)) {
      for (let i = at; i < at + q.length; i += 1) out.add(i);
      return out;
    }
  }
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i += 1) {
    if (lower[i] === q[qi]) {
      out.add(i);
      qi += 1;
    }
  }
  return qi === q.length ? out : new Set<number>();
}

function Highlighted({ label, query }: { label: string; query: string }) {
  const marks = matchedPositions(label, query);
  if (marks.size === 0) return <>{label}</>;
  const parts: ReactNode[] = [];
  let run = "";
  let runBold = false;
  const flush = (key: number) => {
    if (!run) return;
    parts.push(
      runBold ? (
        <span key={key} className="font-semibold">
          {run}
        </span>
      ) : (
        run
      ),
    );
    run = "";
  };
  Array.from(label).forEach((ch, i) => {
    const bold = marks.has(i);
    if (bold !== runBold) {
      flush(i);
      runBold = bold;
    }
    run += ch;
  });
  flush(label.length);
  return <>{parts}</>;
}

/** True when Ctrl/Cmd+K must be left to the focused control or an open dialog. */
export function shouldIgnoreJumpShortcut(e: KeyboardEvent): boolean {
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest('[contenteditable]:not([contenteditable="false"])')) {
    return true;
  }
  if (target?.closest("[data-own-shortcuts]")) return true;
  if (typeof document !== "undefined" && document.querySelector("dialog[open]"))
    return true;
  return false;
}

/** Opens Jump to on Ctrl+K / Cmd+K anywhere in the hub, with the Pitfall 18 guards. */
export function useJumpShortcut(onOpen: () => void, enabled = true): void {
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "k") return;
      if (e.defaultPrevented || shouldIgnoreJumpShortcut(e)) return;
      e.preventDefault();
      onOpenRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

export interface JumpToDialogProps {
  entries: readonly JumpEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives an index href only; the app navigates through its nav guard. */
  onNavigate: (href: string) => void;
}

export function JumpToDialog({
  entries,
  open,
  onOpenChange,
  onNavigate,
}: JumpToDialogProps) {
  const ref = useModalDialog(open, () => onOpenChange(false));
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={
        "mx-auto mt-0 mb-auto w-full max-w-none rounded-b bg-hub-surface p-0 font-hub " +
        "text-hub-ink shadow-xl backdrop:bg-hub-ink/40 sm:mt-24 sm:w-[calc(100%-32px)] " +
        "sm:max-w-[560px] sm:rounded"
      }
    >
      <h2 id={titleId} className="sr-only">
        {SHELL_COPY.jumpDialogTitle}
      </h2>
      {open ? (
        <JumpPalette
          entries={entries}
          onNavigate={(href) => {
            onOpenChange(false);
            onNavigate(href);
          }}
        />
      ) : null}
    </dialog>
  );
}

function JumpPalette({
  entries,
  onNavigate,
}: {
  entries: readonly JumpEntry[];
  onNavigate: (href: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputId = `${baseId}-input`;

  const results = useMemo(() => {
    const filtered = filterJumpEntries(entries, query);
    // Display order: Screens, then Help articles, each keeping its rank order.
    return GROUP_ORDER.flatMap((g) => filtered.filter((e) => e.group === g));
  }, [entries, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const activeIndex =
    results.length === 0 ? -1 : Math.min(active, results.length - 1);

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = document.getElementById(optionId(activeIndex)) as
      (HTMLElement & { scrollIntoView?: (o?: object) => void }) | null;
    el?.scrollIntoView?.({ block: "nearest" });
    // optionId is derived from a stable id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const n = results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setActive((activeIndex + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActive((activeIndex - 1 + n) % n);
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      if (n) setActive(n - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = results[activeIndex];
      if (entry) onNavigate(entry.href);
    }
  };

  const onHelpCenter = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(SHELL_COPY.jumpHelpCenterHref);
  };

  const trimmed = query.trim();
  let row = -1;

  return (
    <div className="flex flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-hub-border px-4">
        <Search
          aria-hidden="true"
          size={20}
          strokeWidth={2}
          className="shrink-0 text-hub-ink-muted"
        />
        <label htmlFor={inputId} className="sr-only">
          {SHELL_COPY.jumpInputLabel}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          placeholder={SHELL_COPY.jumpPlaceholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-hub-ink placeholder:text-hub-ink-muted focus:outline-none"
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={SHELL_COPY.jumpDialogTitle}
        className="max-h-[400px] overflow-y-auto py-1 empty:hidden"
      >
        {GROUP_ORDER.map((group) => {
          const inGroup = results.filter((e) => e.group === group);
          if (inGroup.length === 0) return null;
          const headerId = `${baseId}-${group === "Screens" ? "screens" : "help"}`;
          return (
            <div key={group} role="group" aria-labelledby={headerId}>
              <div
                id={headerId}
                role="presentation"
                className="px-4 pt-3 pb-1 text-sm font-semibold text-hub-ink-muted"
              >
                {group === "Screens"
                  ? SHELL_COPY.jumpGroupScreens
                  : SHELL_COPY.jumpGroupHelp}
              </div>
              {inGroup.map((entry) => {
                row += 1;
                const i = row;
                const selected = i === activeIndex;
                const Icon = group === "Screens" ? PanelsTopLeft : CircleHelp;
                const path =
                  entry.path ??
                  (group === "Help articles"
                    ? SHELL_COPY.jumpHelpPath
                    : undefined);
                return (
                  <div
                    key={`${entry.href}#${i}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onNavigate(entry.href)}
                    className={
                      "flex min-h-12 cursor-pointer items-center gap-3 px-4 py-1 " +
                      (selected ? "bg-hub-surface-2" : "")
                    }
                  >
                    <Icon
                      aria-hidden="true"
                      size={16}
                      strokeWidth={2}
                      className="shrink-0 text-hub-ink-muted"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-base">
                        <Highlighted label={entry.label} query={query} />
                      </span>
                      {path ? (
                        <span className="truncate text-sm text-hub-ink-muted">
                          {path}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {trimmed && results.length === 0 ? (
        <p className="px-4 py-6 text-base text-hub-ink-muted">
          {SHELL_COPY.jumpEmptyBefore(trimmed)}
          <a
            href={SHELL_COPY.jumpHelpCenterHref}
            onClick={onHelpCenter}
            className="text-hub-accent underline underline-offset-2"
          >
            {SHELL_COPY.jumpEmptyLink}
          </a>
          {SHELL_COPY.jumpEmptyAfter}
        </p>
      ) : null}
      <p role="status" className="sr-only">
        {SHELL_COPY.jumpCount(results.length)}
      </p>
    </div>
  );
}
