"use client";
// Staff Find (13-09; STAFF-05, D119; 13-UI-SPEC "StaffFind"). The hub Jump to geometry
// (native <dialog> via useModalDialog, 560px, 96px from the top, 48px rows, combobox +
// listbox, arrows move, Enter opens, Esc closes) with the console's four groups:
// - Tickets: an injected `searchTickets(q)` server action (the server re-checks the staff
//   session; this component only shows what comes back). "1042" or "#1042" puts that ticket
//   first. Typed text is debounced 150ms; a stale answer never replaces a newer one.
// - Sites, Cases, Screens: filtered from an injected, server-built static index (max 5 sites,
//   5 cases, 8 screens). The empty query lists the Screens. Since 13-47 the server search may
//   also return Sites / Cases entries (org id, host, R-n / I-n / W-n); they lead their group.
// Ctrl/Cmd K opening lives in the shell (useJumpShortcut, the hub's Pitfall 18 guards).
import {
  Briefcase,
  Globe,
  LifeBuoy,
  PanelsTopLeft,
  Search,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useModalDialog } from "../../hub/useModalDialog";
import { STAFF_SHELL_COPY } from "./copy";

/** One static Find entry, built server-side from STAFF_SECTIONS, sites and open cases. */
export interface StaffFindEntry {
  group: "Sites" | "Cases" | "Screens";
  label: string;
  href: string;
  /** Extra words that match but are not shown (host, org id). */
  keywords?: string;
  /** Label line under the title ("Tickets › Inbox", a host). */
  path?: string;
}

/** One ticket from `searchTickets`. */
export interface StaffFindTicket {
  number: number;
  subject: string;
  href: string;
  site?: string;
}

/**
 * The server search: tickets, plus (13-47) Sites / Cases entries the server found for the
 * query (a site by org id or host, a case by R-n / I-n / W-n). Entries carry their `group`.
 */
export type StaffFindSearch = (
  q: string,
) => Promise<readonly (StaffFindTicket | StaffFindEntry)[]>;

function isEntry(x: StaffFindTicket | StaffFindEntry): x is StaffFindEntry {
  return "group" in x;
}

export interface StaffFindProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: readonly StaffFindEntry[];
  searchTickets: StaffFindSearch;
  onNavigate: (href: string) => void;
}

type Group = "Tickets" | StaffFindEntry["group"];
const GROUP_ORDER: readonly Group[] = ["Tickets", "Sites", "Cases", "Screens"];
const GROUP_MAX: Record<Group, number> = {
  Tickets: 5,
  Sites: 5,
  Cases: 5,
  Screens: 8,
};
const GROUP_ICON = {
  Tickets: LifeBuoy,
  Sites: Globe,
  Cases: Briefcase,
  Screens: PanelsTopLeft,
} as const;
export const FIND_DEBOUNCE_MS = 150;

interface Row {
  group: Group;
  label: string;
  href: string;
  path?: string;
}

/** `1042` / `#1042` → 1042, else null. */
export function ticketNumberQuery(q: string): number | null {
  const m = /^#?(\d{1,9})$/.exec(q.trim());
  return m ? Number(m[1]) : null;
}

/** The exact ticket first (when the query is a number), then the server's order, max 5. */
export function orderTickets(
  tickets: readonly StaffFindTicket[],
  q: string,
): StaffFindTicket[] {
  const n = ticketNumberQuery(q);
  const list = [...tickets];
  if (n !== null) {
    const at = list.findIndex((t) => t.number === n);
    if (at > 0) list.unshift(...list.splice(at, 1));
  }
  return list.slice(0, GROUP_MAX.Tickets);
}

function rank(entry: StaffFindEntry, q: string): number | null {
  const label = entry.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  const hay = [entry.label, entry.path, entry.keywords]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const at = hay.indexOf(q);
  if (at === -1) return null;
  return at === 0 || /[^\p{L}\p{N}]/u.test(hay[at - 1] ?? "") ? 1 : 2;
}

/** Filter the static index; the empty query lists the Screens in index order. */
export function filterFindEntries(
  index: readonly StaffFindEntry[],
  query: string,
): StaffFindEntry[] {
  const q = query.trim().toLowerCase();
  if (!q)
    return index
      .filter((e) => e.group === "Screens")
      .slice(0, GROUP_MAX.Screens);
  const scored: { e: StaffFindEntry; i: number; r: number }[] = [];
  index.forEach((e, i) => {
    const r = rank(e, q);
    if (r !== null) scored.push({ e, i, r });
  });
  scored.sort((a, b) => a.r - b.r || a.i - b.i);
  const out: StaffFindEntry[] = [];
  const counts: Partial<Record<Group, number>> = {};
  for (const { e } of scored) {
    const c = counts[e.group] ?? 0;
    if (c >= GROUP_MAX[e.group]) continue;
    counts[e.group] = c + 1;
    out.push(e);
  }
  return out;
}

export function StaffFind({
  open,
  onOpenChange,
  index,
  searchTickets,
  onNavigate,
}: StaffFindProps) {
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
        {STAFF_SHELL_COPY.findTitle}
      </h2>
      {open ? (
        <FindPalette
          index={index}
          searchTickets={searchTickets}
          onNavigate={(href) => {
            onOpenChange(false);
            onNavigate(href);
          }}
        />
      ) : null}
    </dialog>
  );
}

function FindPalette({
  index,
  searchTickets,
  onNavigate,
}: {
  index: readonly StaffFindEntry[];
  searchTickets: StaffFindSearch;
  onNavigate: (href: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [tickets, setTickets] = useState<{
    q: string;
    list: readonly (StaffFindTicket | StaffFindEntry)[];
  }>({ q: "", list: [] });
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputId = `${baseId}-input`;
  const trimmed = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    if (!trimmed) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchTickets(trimmed).then(
        (list) => {
          if (seq.current !== mine) return;
          setTickets({ q: trimmed, list });
          setSearching(false);
        },
        (err: unknown) => {
          if (seq.current !== mine) return;
          // Class name only (no query text in logs).
          console.warn(
            "staff-find:search-failed",
            err instanceof Error ? err.name : typeof err,
          );
          setTickets({ q: trimmed, list: [] });
          setSearching(false);
        },
      );
    }, FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, searchTickets]);

  const rows = useMemo<Row[]>(() => {
    const fresh = trimmed && tickets.q === trimmed ? tickets.list : [];
    const ticketRows: Row[] = orderTickets(
      fresh.filter((x): x is StaffFindTicket => !isEntry(x)),
      trimmed,
    ).map((t) => ({
      group: "Tickets",
      label: STAFF_SHELL_COPY.ticketLabel(t.number, t.subject),
      href: t.href,
      path: t.site,
    }));
    // Server-found Sites / Cases first, then the static index; one row per href, group caps.
    const seen = new Set<string>();
    const perGroup: Partial<Record<Group, number>> = {};
    const staticRows: Row[] = [
      ...fresh.filter(isEntry),
      ...filterFindEntries(index, trimmed),
    ].filter((e) => {
      if (seen.has(e.href)) return false;
      const c = perGroup[e.group] ?? 0;
      if (c >= GROUP_MAX[e.group]) return false;
      seen.add(e.href);
      perGroup[e.group] = c + 1;
      return true;
    });
    return GROUP_ORDER.flatMap((g) =>
      g === "Tickets" ? ticketRows : staticRows.filter((r) => r.group === g),
    );
  }, [index, tickets, trimmed]);

  const activeIndex =
    rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  // WR-E12: focus stays on the input (aria-activedescendant), so keep the active option visible.
  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${baseId}-opt-${activeIndex}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, baseId]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const n = rows.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setActive((activeIndex + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActive((activeIndex - 1 + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) onNavigate(row.href);
    }
  };

  let at = -1;
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
          {STAFF_SHELL_COPY.findInputLabel}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-hub-ink focus:outline-none"
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={STAFF_SHELL_COPY.findTitle}
        className="max-h-[400px] overflow-y-auto py-1 empty:hidden"
      >
        {GROUP_ORDER.map((group) => {
          const inGroup = rows.filter((r) => r.group === group);
          if (inGroup.length === 0) return null;
          const Icon = GROUP_ICON[group];
          const label = STAFF_SHELL_COPY.findGroups[group];
          return (
            <div key={group} role="group" aria-label={label}>
              <div
                role="presentation"
                className="px-4 pt-3 pb-1 text-sm font-semibold text-hub-ink-muted"
              >
                {label}
              </div>
              {inGroup.map((row) => {
                at += 1;
                const i = at;
                const selected = i === activeIndex;
                return (
                  <div
                    key={`${row.href}#${i}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onNavigate(row.href)}
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
                      <span className="truncate text-base">{row.label}</span>
                      {row.path ? (
                        <span className="truncate text-sm text-hub-ink-muted">
                          {row.path}
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
      {trimmed && rows.length === 0 && !searching ? (
        <p className="px-4 py-6 text-base text-hub-ink-muted">
          {STAFF_SHELL_COPY.findEmpty(trimmed)}
        </p>
      ) : null}
      <p role="status" className="sr-only">
        {searching
          ? STAFF_SHELL_COPY.findSearching
          : STAFF_SHELL_COPY.findCount(rows.length)}
      </p>
    </div>
  );
}
