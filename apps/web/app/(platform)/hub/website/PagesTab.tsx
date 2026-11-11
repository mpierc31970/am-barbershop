// Pages tab (CONT-30; UI-SPEC "Pages tab", "Color / Hub" badges). Focal point is the status
// column: "Unpublished changes" and "In review" are the only tinted elements in the list,
// and Add page is the one accent control. A semantic table at 768px and up, stacked rows
// below. Home first, then by title. The title is the one link per row (to the builder).
// 07-32 (CONT-28, D235 #11; 07-UI-SPEC lines 498-505; choices 9, 10): a "Page not found" system
// row right after Home (URL "—", System page badge, "Not counted in your 10 pages"). Before the
// 404 page exists its title is a small form that creates it on first open; members without
// content write see plain text. Protected pages get the Password badge. The 404 page is never
// in `pages`, so the 10-page count is unchanged.
// 11-28 (DASH-08, D185, D273): the count is the server's `{ used, allowance }` (pagesUsage),
// never a constant. Rows that don't use the allowance (password pages; the 404 row) say
// "Doesn't count" in the URL cell; at the limit AddPageRow shows PagesFullPanel for `who`.
// 11-30 (DASH-06; UI-SPEC "Page delete and Recently deleted"): each page row ends with the
// PageRowMenu overflow (Open, Page settings, Delete page); Home and system rows have no
// Delete, and without content write (Viewer) the menu is Open only. Recently deleted (the
// last 30 days, with Restore) sits below the table; absent when the bin is empty.
import { countsTowardLimit } from "@cds/core/content";
import { Badge, type BadgeTone } from "@cds/ui/hub";
import type { PageSummary } from "@cds/db";
import Link from "next/link";
import { openNotFoundPageAction } from "../../../actions/page-settings";
import { AddPageRow } from "./AddPageRow";
import { PageRowMenu } from "./PageRowMenu";
import {
  RecentlyDeletedList,
  type DeletedPageView,
} from "./RecentlyDeletedList";
import { HOME_SLUG, formatLastPublished, pagePath } from "./page-slug";
import type { PagesFullWho } from "./PagesFullPanel";

type StatusBadge = { tone: BadgeTone; label: string };

/** Status words for a page (never colour alone). Home adds its own badge. */
export function statusBadges(p: PageSummary): StatusBadge[] {
  const out: StatusBadge[] = [];
  if (p.slug === HOME_SLUG) out.push({ tone: "home", label: "Home" });
  if (p.status === "held") out.push({ tone: "review", label: "In review" });
  else if (p.status === "draft" || !p.published_at) {
    out.push({ tone: "draft", label: "Draft" });
  } else if (p.has_unpublished_changes) {
    out.push({ tone: "changes", label: "Unpublished changes" });
  } else out.push({ tone: "published", label: "Published" });
  if (p.password_protected) out.push({ tone: "password", label: "Password" });
  return out;
}

/** The system row's badges: System page, then its status once it exists. */
export function systemBadges(p: PageSummary | null): StatusBadge[] {
  const out: StatusBadge[] = [{ tone: "system-page", label: "System page" }];
  if (p) out.push(...statusBadges(p).filter((b) => b.tone !== "password"));
  return out;
}

export const NOT_FOUND_ROW = Object.freeze({
  title: "Page not found",
  url: "\u2014",
  notCounted: "Doesn't count",
});

/** UI-SPEC: Label "Doesn't count", read out with its reason. */
export const DOESNT_COUNT = Object.freeze({
  label: "Doesn't count",
  sr: "Doesn't count toward your page allowance",
});

function DoesntCount() {
  return (
    <span className="text-sm text-hub-ink-muted" data-doesnt-count="">
      <span aria-hidden="true">{DOESNT_COUNT.label}</span>
      <span className="sr-only">{DOESNT_COUNT.sr}</span>
    </span>
  );
}

function homeFirst(pages: readonly PageSummary[]): PageSummary[] {
  return [
    ...pages.filter((p) => p.slug === HOME_SLUG),
    ...pages.filter((p) => p.slug !== HOME_SLUG),
  ];
}

function builderHref(id: string): string {
  return `/hub/website/pages/${encodeURIComponent(id)}`;
}

function Badges({
  page,
  badges,
}: {
  page?: PageSummary;
  badges?: StatusBadge[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(badges ?? (page ? statusBadges(page) : [])).map((b) => (
        <Badge key={b.label} tone={b.tone}>
          {b.label}
        </Badge>
      ))}
    </div>
  );
}

const TITLE_LINK =
  "font-semibold text-hub-ink underline-offset-4 hover:text-hub-accent hover:underline";
const TITLE_BUTTON = `${TITLE_LINK} min-h-11 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent`;

/** The system row's title: builder link, create-on-open form, or plain text. */
function NotFoundTitle({
  page,
  canEdit,
}: {
  page: PageSummary | null;
  canEdit: boolean;
}) {
  if (page) {
    return (
      <Link href={builderHref(page.id)} className={TITLE_LINK}>
        {NOT_FOUND_ROW.title}
      </Link>
    );
  }
  if (canEdit) {
    return (
      <form action={openNotFoundPageAction} data-not-found-open="">
        <button type="submit" className={TITLE_BUTTON}>
          {NOT_FOUND_ROW.title}
        </button>
      </form>
    );
  }
  return (
    <span className="font-semibold text-hub-ink">{NOT_FOUND_ROW.title}</span>
  );
}

export function PagesTab({
  pages,
  reserved,
  navTopCount = 0,
  notFoundPage = null,
  canEdit = false,
  usage = null,
  who,
  deleted = [],
}: {
  pages: readonly PageSummary[];
  reserved: readonly string[];
  /** Top-level menu links (07-25): drives the Add page menu checkbox. */
  navTopCount?: number;
  /** 07-32: the org's system 404 page (null before first open). */
  notFoundPage?: PageSummary | null;
  /** 07-32: content write; without it the system row title is plain text. */
  canEdit?: boolean;
  /** 11-28: the server's counted pages and allowance (null when the read failed). */
  usage?: { used: number; allowance: number } | null;
  /** 11-28: who is looking (at-limit panel). */
  who?: PagesFullWho;
  /** 11-30: Recently deleted (listRecentlyDeleted); empty hides the section. */
  deleted?: readonly DeletedPageView[];
}) {
  const rows = homeFirst(pages);
  const homeCount = rows.filter((p) => p.slug === HOME_SLUG).length;
  const sysBadges = systemBadges(notFoundPage);
  return (
    <AddPageRow
      {...(usage ? { count: usage.used, limit: usage.allowance } : {})}
      {...(who ? { who } : {})}
      taken={rows.map((p) => p.slug)}
      reserved={reserved}
      navTopCount={navTopCount}
    >
      {rows.length > 0 ? (
        <>
          <table className="hidden w-full border-collapse text-left md:table">
            <thead>
              <tr className="border-b border-hub-border text-sm font-semibold text-hub-ink-muted">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Title
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  URL
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Last published
                </th>
                <th scope="col" className="w-14 px-2 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, homeCount).map((p) => (
                <PageRow key={p.id} page={p} canEdit={canEdit} />
              ))}
              <tr
                className="h-14 border-b border-hub-border transition-colors duration-150 hover:bg-hub-surface-2"
                data-system-row=""
              >
                <th scope="row" className="px-4 py-2 font-normal">
                  <NotFoundTitle page={notFoundPage} canEdit={canEdit} />
                </th>
                <td className="px-4 py-2 text-hub-ink-muted">
                  <span aria-label="No address">{NOT_FOUND_ROW.url}</span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-col gap-1">
                    <Badges badges={sysBadges} />
                    <DoesntCount />
                  </div>
                </td>
                <td className="px-4 py-2 text-sm text-hub-ink-muted tabular-nums">
                  {notFoundPage
                    ? formatLastPublished(notFoundPage.published_at)
                    : ""}
                </td>
                <td className="px-2 py-2" />
              </tr>
              {rows.slice(homeCount).map((p) => (
                <PageRow key={p.id} page={p} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
          <ul className="flex flex-col md:hidden">
            {rows.slice(0, homeCount).map((p) => (
              <PageItem key={p.id} page={p} canEdit={canEdit} />
            ))}
            <li
              className="flex flex-col gap-2 border-b border-hub-border py-4"
              data-system-row=""
            >
              <NotFoundTitle page={notFoundPage} canEdit={canEdit} />
              <span className="text-sm text-hub-ink-muted">
                <span aria-label="No address">{NOT_FOUND_ROW.url}</span>
              </span>
              <Badges badges={sysBadges} />
              <DoesntCount />
            </li>
            {rows.slice(homeCount).map((p) => (
              <PageItem key={p.id} page={p} canEdit={canEdit} />
            ))}
          </ul>
          <RecentlyDeletedList pages={deleted} />
        </>
      ) : null}
    </AddPageRow>
  );
}

/** Home and system pages can't be deleted (the server refuses them too). */
export function isDeletable(p: PageSummary): boolean {
  return p.slug !== HOME_SLUG && p.kind === "builder";
}

function RowMenu({
  page: p,
  canEdit,
}: {
  page: PageSummary;
  canEdit: boolean;
}) {
  return (
    <PageRowMenu
      page={{ id: p.id, title: p.title, slug: p.slug }}
      canEdit={canEdit}
      deletable={isDeletable(p)}
    />
  );
}

function PageRow({
  page: p,
  canEdit,
}: {
  page: PageSummary;
  canEdit: boolean;
}) {
  return (
    <tr
      key={p.id}
      className="h-14 border-b border-hub-border transition-colors duration-150 hover:bg-hub-surface-2"
    >
      <th scope="row" className="px-4 py-2 font-normal">
        <Link href={builderHref(p.id)} className={TITLE_LINK}>
          {p.title}
        </Link>
      </th>
      <td className="px-4 py-2 text-hub-ink-muted">
        <div className="flex flex-col gap-1">
          <span>{pagePath(p.slug)}</span>
          {countsTowardLimit(p) ? null : <DoesntCount />}
        </div>
      </td>
      <td className="px-4 py-2">
        <Badges page={p} />
      </td>
      <td className="px-4 py-2 text-sm text-hub-ink-muted tabular-nums">
        {formatLastPublished(p.published_at)}
      </td>
      <td className="px-2 py-2 text-right">
        <RowMenu page={p} canEdit={canEdit} />
      </td>
    </tr>
  );
}

function PageItem({
  page: p,
  canEdit,
}: {
  page: PageSummary;
  canEdit: boolean;
}) {
  return (
    <li
      key={p.id}
      className="flex flex-col gap-2 border-b border-hub-border py-4"
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={builderHref(p.id)} className={TITLE_LINK}>
          {p.title}
        </Link>
        <RowMenu page={p} canEdit={canEdit} />
      </div>
      <span className="text-sm text-hub-ink-muted">{pagePath(p.slug)}</span>
      {countsTowardLimit(p) ? null : <DoesntCount />}
      <Badges page={p} />
      <span className="text-sm text-hub-ink-muted tabular-nums">
        Last published {formatLastPublished(p.published_at)}
      </span>
    </li>
  );
}
