// The site search form (07-31; CONT-28, D277; 07-UI-SPEC "Search" lines 535-537).
//
// A plain GET form to /search: works without JS. role="search", a visible label "Search this
// site" bound to a 48px <input type="search" name="q"> (maxLength 100, the query cap), and the
// primary **Search** button. Shared with 07-32's 404 (NotFoundExtras). Theme roles only.
// Server component: no hooks, no next/* imports.
import { siteButtonClasses } from "./SiteButton";
import { BODY_CLASS } from "./types";

export const SEARCH_FORM_COPY = Object.freeze({
  label: "Search this site",
  button: "Search",
});

export interface SiteSearchFormProps {
  defaultValue?: string;
  autoFocus?: boolean;
  /** Input id; pass another when two forms share a page. */
  id?: string;
}

const CONTROL =
  "w-full min-h-12 rounded-site-button border border-site-text-muted bg-site-surface " +
  "px-4 py-3 text-[length:var(--site-text-body)] text-site-text " +
  "placeholder:text-site-text-muted";

export function SiteSearchForm({
  defaultValue,
  autoFocus,
  id = "site-search-q",
}: SiteSearchFormProps) {
  return (
    <form
      role="search"
      action="/search"
      method="get"
      className={`${BODY_CLASS} flex flex-col gap-3 sm:flex-row sm:items-end`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label htmlFor={id} className="font-semibold text-site-text">
          {SEARCH_FORM_COPY.label}
        </label>
        <input
          id={id}
          type="search"
          name="q"
          maxLength={100}
          autoComplete="off"
          defaultValue={defaultValue ?? ""}
          autoFocus={autoFocus}
          className={CONTROL}
        />
      </div>
      <button type="submit" className={siteButtonClasses("primary")}>
        {SEARCH_FORM_COPY.button}
      </button>
    </form>
  );
}
