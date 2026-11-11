// @cds/ui/site P7 search (owner 07-31; 07-02 seam).
// Site area barrel: server components only; no next/*, no client hooks.
// Pagination (07-22) is re-exported here (it is in no other barrel); 07-32's 404 reuses
// SiteSearchForm and PopularPages.
export {
  SEARCH_COPY,
  SearchResults,
  searchCountCopy,
  searchPageHref,
  type SearchResultView,
  type SearchResultsProps,
} from "../SearchResults";
export {
  SEARCH_FORM_COPY,
  SiteSearchForm,
  type SiteSearchFormProps,
} from "../SiteSearchForm";
export {
  PopularPages,
  type PopularLink,
  type PopularPagesProps,
} from "../PopularPages";
export {
  Pagination,
  paginationWindow,
  type PaginationEntry,
  type PaginationProps,
} from "../Pagination";
