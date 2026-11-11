// Site search results (07-31; CONT-28, CONT-37, D277; 07-UI-SPEC lines 187, 535-542, 643).
//
// Count line (role="status", aria-live polite, body text-muted) "4 results for “sourdough”",
// then a list with a 32px gap: title <h2> styled at h3 600 as a primary link (relative path),
// the URL and the record kind ("Service") in text-muted, and the snippet (body, at most two
// lines) with matched words in <mark> (transparent, 600). 10 per page with the shared
// Pagination ("Search results pages"). Snippets arrive as { text, match } segments and render
// as React text, never raw HTML (T-07-31-03). Theme roles only, 44px targets.
// Server component: no hooks, no next/* imports.
import { Pagination } from "./Pagination";
import { BODY_CLASS, HEADING_CLASSES } from "./types";

export type SearchResultView = {
  title: string;
  path: string;
  kind: string | null;
  snippet: readonly { text: string; match: boolean }[];
};

export interface SearchResultsProps {
  query: string;
  total: number;
  results: readonly SearchResultView[];
  /** Shown before each path on the URL line, e.g. "crumbbakery.com". */
  hostLabel: string;
  page: number;
  pages: number;
}

/** Visitor copy for the /search page (07-UI-SPEC lines 537, 569, 642). */
export const SEARCH_COPY = Object.freeze({
  title: "Search",
  empty: "Type a word or two to search this site.",
  none: (q: string) =>
    `No results for “${q}”. Try a shorter word, or one of these pages:`,
  error: "Search isn't working right now. Try again in a minute.",
});

export function searchCountCopy(total: number, query: string): string {
  return `${total} ${total === 1 ? "result" : "results"} for “${query}”`;
}

export function searchPageHref(query: string, page: number): string {
  return `/search?q=${encodeURIComponent(query)}&page=${page}`;
}

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";

export function SearchResults({
  query,
  total,
  results,
  hostLabel,
  page,
  pages,
}: SearchResultsProps) {
  return (
    <div className={`${BODY_CLASS} flex flex-col gap-8`}>
      <p role="status" aria-live="polite" className="text-site-text-muted">
        {searchCountCopy(total, query)}
      </p>
      <ol className="flex flex-col gap-8" data-search-results="">
        {results.map((r, i) => (
          <li key={`${r.path}-${i}`} className="flex flex-col gap-1">
            <h2 className={HEADING_CLASSES[3]}>
              <a
                href={r.path}
                className={`inline-flex min-h-11 items-center text-site-primary underline-offset-4 hover:underline ${FOCUS}`}
              >
                {r.title || r.path}
              </a>
            </h2>
            <p className="text-site-text-muted break-all">
              {`${hostLabel}${r.path}`}
              {r.kind ? <span>{` · ${r.kind}`}</span> : null}
            </p>
            {r.snippet.length > 0 ? (
              <p className="line-clamp-2 text-site-text">
                {r.snippet.map((s, j) =>
                  s.match ? (
                    <mark
                      key={j}
                      className="bg-transparent font-semibold text-site-text"
                    >
                      {s.text}
                    </mark>
                  ) : (
                    <span key={j}>{s.text}</span>
                  ),
                )}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <Pagination
        label="Search results pages"
        current={page}
        total={pages}
        hrefFor={(n) => searchPageHref(query, n)}
      />
    </div>
  );
}
