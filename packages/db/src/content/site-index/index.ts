// @cds/db P7 area barrel: Site index + search (owner 07-31).
// Named exports only; never export a PocketBase client, a context minter or an internal
// writer helper (invariant 1). Wired into src/index.ts with `export *` (07-02).
// refreshSiteIndex is internal (import it by path from ./build), never exported here.
export { readSiteIndex } from "./read";
export type { SiteIndex, SiteIndexPage, SiteIndexRecord } from "@cds/core/seo";
