// Pagination: numbered server-rendered page links (07-22; CONT-22, CONT-37, D228; 07-UI-SPEC
// "Pagination" lines 540-541, colour row 188, 44px targets line 87).
//
// Shared: 07-31 `/search` reuses it (re-export from its own site/p7/search.ts; this file is
// in no barrel). Plain links only: no client JS, no infinite scroll. The current page is a
// <span aria-current="page"> (never a link), the window holds at most 7 entries with "…"
// gaps (aria-hidden), and an sr-only "Page 2 of 3" names where the visitor is.
// Server component: no hooks, no next/* imports. Theme roles (--site-*) only.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BODY_CLASS } from "./types";

export type PaginationEntry = number | "…";

/** Up to 7 entries: first, last, the current page's neighbours, "…" for gaps. */
export function paginationWindow(
  current: number,
  total: number,
): PaginationEntry[] {
  const t = Math.floor(total);
  if (!Number.isFinite(t) || t <= 1) return [];
  const c = Math.min(t, Math.max(1, Math.floor(current) || 1));
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);
  if (c <= 4) return [1, 2, 3, 4, 5, "…", t];
  if (c >= t - 3) return [1, "…", t - 4, t - 3, t - 2, t - 1, t];
  return [1, "…", c - 1, c, c + 1, "…", t];
}

export interface PaginationProps {
  /** "Gallery pages" or "Search results pages". */
  label: string;
  current: number;
  total: number;
  hrefFor: (page: number) => string;
  className?: string;
}

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";
const TARGET =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-site-button";
const LINK = `${TARGET} px-2 text-site-primary hover:underline underline-offset-4 ${FOCUS}`;
const STEP = `${TARGET} gap-1 px-3`;

export function Pagination({
  label,
  current,
  total,
  hrefFor,
  className,
}: PaginationProps) {
  const entries = paginationWindow(current, total);
  if (entries.length === 0) return null;
  const pages = Math.floor(total);
  const page = Math.min(pages, Math.max(1, Math.floor(current) || 1));

  return (
    <nav
      aria-label={label}
      className={`${BODY_CLASS} tabular-nums ${className ?? ""}`.trim()}
    >
      <p className="sr-only">{`Page ${page} of ${pages}`}</p>
      <ul className="flex flex-wrap items-center justify-center gap-1">
        <li>
          {page > 1 ? (
            <a href={hrefFor(page - 1)} className={`${STEP} ${LINK}`}>
              <ChevronLeft size={20} aria-hidden="true" />
              Previous
            </a>
          ) : (
            <span
              aria-disabled="true"
              className={`${STEP} text-site-text-muted`}
            >
              <ChevronLeft size={20} aria-hidden="true" />
              Previous
            </span>
          )}
        </li>
        {entries.map((entry, i) =>
          entry === "…" ? (
            <li
              key={`gap-${i}`}
              aria-hidden="true"
              className={`${TARGET} text-site-text-muted`}
            >
              …
            </li>
          ) : (
            <li key={entry}>
              {entry === page ? (
                <span
                  aria-current="page"
                  className={`${TARGET} px-2 font-semibold text-site-text underline decoration-2 underline-offset-4`}
                >
                  <span className="sr-only">Page </span>
                  {entry}
                </span>
              ) : (
                <a
                  href={hrefFor(entry)}
                  aria-label={`Page ${entry}`}
                  className={LINK}
                >
                  {entry}
                </a>
              )}
            </li>
          ),
        )}
        <li>
          {page < pages ? (
            <a href={hrefFor(page + 1)} className={`${STEP} ${LINK}`}>
              Next
              <ChevronRight size={20} aria-hidden="true" />
            </a>
          ) : (
            <span
              aria-disabled="true"
              className={`${STEP} text-site-text-muted`}
            >
              Next
              <ChevronRight size={20} aria-hidden="true" />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
