// Contacts list table (07-16; CONTACTS-01/02, D311; 07-UI-SPEC "Contacts" table, sizes,
// typography). A real <table> at 768px and up: Name (button that opens the drawer; "No name"
// in ink-muted when empty) · Email · Phone · Tags (2 chips + "+N") · Newsletter (badge or
// empty) · Last activity (tabular). Name and Last activity headers are sort links carrying
// aria-sort. Below 768px the rows stack (name 600 / email / badge). Rows are 56px. Numbered
// pagination (tabular) shows when there is more than one page, the current page marked
// aria-current. Every cell is React text (a visitor-typed name never becomes markup).
// Server-safe: no hooks; navigation comes in through LinkComponent and the href builders.
import { ArrowDown, ArrowUp } from "lucide-react";
import type { AnchorHTMLAttributes, ComponentType } from "react";
import { Badge } from "../Badge";
import {
  CONTACTS_COPY,
  formatDay,
  newsletterBadge,
  tagChips,
  type ContactView,
} from "./copy";

type LinkLike = ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
>;

export type ContactsSort = "last_seen" | "name";

export interface ContactsTableProps {
  rows: readonly ContactView[];
  sort: ContactsSort;
  page: number;
  totalPages: number;
  timeZone: string;
  onOpen: (row: ContactView) => void;
  hrefForSort: (sort: ContactsSort) => string;
  hrefForPage: (page: number) => string;
  LinkComponent?: LinkLike;
  /** Filters are loading: the table dims and is aria-busy. */
  busy?: boolean;
}

const TH = "px-4 py-3 text-left text-sm font-semibold text-hub-ink";

function TagCell({ tags }: { tags: readonly string[] }) {
  const { shown, more } = tagChips(tags);
  if (shown.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((t) => (
        <span
          key={t}
          className="max-w-40 truncate rounded bg-hub-surface-2 px-2 py-1 text-sm text-hub-ink"
        >
          {t}
        </span>
      ))}
      {more > 0 ? (
        <span
          className="text-sm text-hub-ink-muted tabular-nums"
          aria-label={`${more} more tags`}
        >
          {`+${more}`}
        </span>
      ) : null}
    </span>
  );
}

function NameButton({
  row,
  onOpen,
}: {
  row: ContactView;
  onOpen: (row: ContactView) => void;
}) {
  const empty = row.name.trim() === "";
  return (
    <button
      type="button"
      data-contact-open={row.id}
      onClick={() => onOpen(row)}
      className={
        "rounded text-left text-base font-semibold underline-offset-2 hover:underline " +
        "pointer-coarse:min-h-11 " +
        (empty ? "text-hub-ink-muted" : "text-hub-ink")
      }
    >
      {empty ? CONTACTS_COPY.noName : row.name}
    </button>
  );
}

/** Page numbers with gaps: 1 … 4 5 [6] 7 8 … 20. */
export function pageWindow(page: number, total: number): (number | "gap")[] {
  const out: (number | "gap")[] = [];
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - page) <= 2) out.push(n);
    else if (out[out.length - 1] !== "gap") out.push("gap");
  }
  return out;
}

export function ContactsTable({
  rows,
  sort,
  page,
  totalPages,
  timeZone,
  onOpen,
  hrefForSort,
  hrefForPage,
  LinkComponent,
  busy = false,
}: ContactsTableProps) {
  const Link: LinkLike | "a" = LinkComponent ?? "a";
  const sortLink = (key: ContactsSort, label: string) => (
    <Link
      href={hrefForSort(key)}
      className="inline-flex items-center gap-1 rounded underline-offset-2 hover:underline pointer-coarse:min-h-11"
    >
      {label}
      {sort === key ? (
        key === "name" ? (
          <ArrowUp
            aria-hidden
            size={16}
            strokeWidth={2}
            className="text-hub-ink-muted"
          />
        ) : (
          <ArrowDown
            aria-hidden
            size={16}
            strokeWidth={2}
            className="text-hub-ink-muted"
          />
        )
      ) : null}
    </Link>
  );

  return (
    <div
      aria-busy={busy || undefined}
      className={
        "flex flex-col gap-4 font-hub transition-opacity duration-150 " +
        (busy ? "opacity-60" : "")
      }
    >
      <table className="hidden w-full border-collapse md:table">
        <caption className="sr-only">Contacts</caption>
        <thead className="border-b border-hub-border">
          <tr>
            <th
              scope="col"
              className={TH}
              aria-sort={sort === "name" ? "ascending" : "none"}
            >
              {sortLink("name", "Name")}
            </th>
            <th scope="col" className={TH}>
              Email
            </th>
            <th scope="col" className={TH}>
              Phone
            </th>
            <th scope="col" className={TH}>
              Tags
            </th>
            <th scope="col" className={TH}>
              Newsletter
            </th>
            <th
              scope="col"
              className={TH}
              aria-sort={sort === "last_seen" ? "descending" : "none"}
            >
              {sortLink("last_seen", "Last activity")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const badge = newsletterBadge(r.consent.status);
            return (
              <tr
                key={r.id}
                data-contact-row={r.id}
                className="h-14 border-b border-hub-border hover:bg-hub-surface-2"
              >
                <td className="px-4 py-2">
                  <NameButton row={r} onOpen={onOpen} />
                </td>
                <td className="max-w-64 truncate px-4 py-2 text-base text-hub-ink">
                  {r.email}
                </td>
                <td className="px-4 py-2 text-base whitespace-nowrap text-hub-ink tabular-nums">
                  {r.phone}
                </td>
                <td className="px-4 py-2">
                  <TagCell tags={r.tags} />
                </td>
                <td className="px-4 py-2">
                  {badge ? (
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-sm whitespace-nowrap text-hub-ink-muted tabular-nums">
                  {formatDay(r.last_seen_at, timeZone)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul aria-label="Contacts" className="flex flex-col md:hidden">
        {rows.map((r) => {
          const badge = newsletterBadge(r.consent.status);
          return (
            <li
              key={r.id}
              className="flex min-h-14 flex-col gap-1 border-b border-hub-border py-3"
            >
              <NameButton row={r} onOpen={onOpen} />
              <span className="truncate text-sm text-hub-ink-muted">
                {r.email}
              </span>
              {badge ? (
                <span>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {totalPages > 1 ? (
        <nav aria-label="Contact pages">
          <ul className="flex flex-wrap items-center gap-1 text-sm tabular-nums">
            {pageWindow(page, totalPages).map((n, i) =>
              n === "gap" ? (
                <li
                  key={`gap-${i}`}
                  aria-hidden
                  className="px-2 text-hub-ink-muted"
                >
                  …
                </li>
              ) : (
                <li key={n}>
                  <Link
                    href={hrefForPage(n)}
                    aria-current={n === page ? "page" : undefined}
                    aria-label={`Page ${n}`}
                    className={
                      "inline-flex h-10 min-w-10 items-center justify-center rounded px-2 " +
                      "transition-colors duration-150 pointer-coarse:h-11 pointer-coarse:min-w-11 " +
                      (n === page
                        ? "bg-hub-surface-2 font-semibold text-hub-ink"
                        : "text-hub-ink-muted hover:bg-hub-surface-2 hover:text-hub-ink")
                    }
                  >
                    {n}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
