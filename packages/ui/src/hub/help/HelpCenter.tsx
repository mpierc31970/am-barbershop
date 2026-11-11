"use client";
// Help center (11-46; DASH-17, D110, D208; 11-UI-SPEC "Help center" lines 592-601). One 720px
// column: a search box that filters as you type (client-side, over the server-built,
// grant-filtered list: the server never sends an article the person may not read), a polite
// "{n} articles" line, then the groups Your add-ons / Your site / Getting set up (Heading,
// 48px above each), each row a title link (Body 600) and a one-line summary (Label
// ink-muted). No match: HELP-EMPTY with Ask CDS Support. Footer: "Can't find it? Ask CDS
// Support." Search matches every word of the query against title, summary and step text.
import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { HELP_COPY } from "./copy";

export type HelpCenterEntry = {
  id: string;
  title: string;
  summary: string;
  href: string;
  /** Lower-case words the search matches: title, summary and the article's steps. */
  searchText: string;
};

export type HelpCenterGroup = {
  key: string;
  label: string;
  entries: readonly HelpCenterEntry[];
};

export interface HelpCenterProps {
  groups: readonly HelpCenterGroup[];
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

/**
 * Entries whose title or search text holds every word of the query (case-insensitive).
 * Titles that match every word come first; otherwise the given order is kept.
 */
export function filterHelpEntries(
  entries: readonly HelpCenterEntry[],
  query: string,
): HelpCenterEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  const inTitle: HelpCenterEntry[] = [];
  const inText: HelpCenterEntry[] = [];
  for (const e of entries) {
    const title = e.title.toLowerCase();
    if (words.every((w) => title.includes(w))) inTitle.push(e);
    else if (words.every((w) => title.includes(w) || e.searchText.includes(w)))
      inText.push(e);
  }
  return [...inTitle, ...inText];
}

export function HelpCenter({ groups, LinkComponent }: HelpCenterProps) {
  const Link = LinkComponent ?? "a";
  const inputId = useId();
  const countId = useId();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const shown = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, entries: filterHelpEntries(g.entries, trimmed) }))
        .filter((g) => g.entries.length > 0),
    [groups, trimmed],
  );
  const total = shown.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div className="flex flex-col font-hub text-hub-ink" data-help-center="">
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-semibold">
          {HELP_COPY.searchLabel}
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            size={16}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-hub-ink-muted"
          />
          <input
            id={inputId}
            type="search"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={countId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={
              "h-10 w-full rounded border border-hub-border-strong bg-hub-surface pr-3 pl-9 " +
              "text-base text-hub-ink transition-colors duration-150 hover:border-hub-ink-muted " +
              "pointer-coarse:h-11"
            }
          />
        </div>
        <p
          id={countId}
          className="text-sm text-hub-ink-muted"
          aria-live="polite"
          data-help-count=""
        >
          {HELP_COPY.count(total)}
        </p>
      </div>

      {total === 0 ? (
        <p className="mt-12 text-base text-hub-ink-muted" data-help-empty="">
          {trimmed ? HELP_COPY.emptyBefore(trimmed) : HELP_COPY.noneBefore}
          <Link href={HELP_COPY.supportHref} className={LINK}>
            {HELP_COPY.emptyLink}
          </Link>
          {HELP_COPY.emptyAfter}
        </p>
      ) : (
        shown.map((g) => (
          <section
            key={g.key}
            aria-labelledby={`${inputId}-${g.key}`}
            className="mt-12"
            data-help-group={g.key}
          >
            <h2
              id={`${inputId}-${g.key}`}
              className="text-xl leading-tight font-semibold"
            >
              {g.label}
            </h2>
            <ul className="mt-2">
              {g.entries.map((e) => (
                <li
                  key={e.id}
                  className="border-b border-hub-border py-4 last:border-b-0"
                  data-help-row={e.id}
                >
                  <Link
                    href={e.href}
                    className={
                      "rounded text-base font-semibold text-hub-ink underline-offset-2 hover:underline " +
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                    }
                  >
                    {e.title}
                  </Link>
                  {e.summary ? (
                    <p className="mt-1 truncate text-sm text-hub-ink-muted">
                      {e.summary}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <p className="mt-12 text-sm text-hub-ink-muted" data-help-footer="">
        {HELP_COPY.footerBefore}
        <Link href={HELP_COPY.supportHref} className={LINK}>
          {HELP_COPY.askSupport}
        </Link>
        {HELP_COPY.footerAfter}
      </p>
    </div>
  );
}
