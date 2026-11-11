// The fixed 404 extras (CONT-28, D235 #11, D-UI-P7-31; 07-UI-SPEC line 529): under the
// editable 404 blocks (or the default), always a search form (only when search is on) and
// "Popular pages" (the menu's top-level links). A thin composition of 07-31's SiteSearchForm
// and PopularPages: no second form or link list; this file adds only the spacing.
// Server component: no hooks, no next/* imports, never the db package.
import { PopularPages, type PopularLink } from "./PopularPages";
import { SiteSearchForm } from "./SiteSearchForm";

export const NOT_FOUND_COPY = Object.freeze({
  title: "We can't find that page",
  body: "The page may have moved, or the address may have a typo.",
  popular: "Popular pages",
});

export interface NotFoundExtrasProps {
  /** Resolved top-level menu links (apps/web popularPages). */
  links: readonly PopularLink[];
  /** live.settings.show_search */
  showSearch: boolean;
}

export function NotFoundExtras({ links, showSearch }: NotFoundExtrasProps) {
  if (!showSearch && links.length === 0) return null;
  return (
    <div
      className="mx-auto max-w-[1120px] px-6 pb-16 md:px-8"
      data-not-found-extras=""
    >
      <div className="flex max-w-[720px] flex-col gap-8">
        {showSearch ? <SiteSearchForm id="nf-search-q" /> : null}
        <PopularPages links={links} heading={NOT_FOUND_COPY.popular} />
      </div>
    </div>
  );
}
