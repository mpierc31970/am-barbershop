// THE exclusion rule (07-31 choice 1; CONT-37, D277, Pitfall 13). No consumer filters:
// sitemap.xml, robots.txt, llms.txt and /search read only index.json, and index.json holds
// only pages that pass isIndexablePage. 07-32 changes what "protected" means only in db
// `isProtected` / the build query, never here.
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import { NOINDEX_PAGE_KINDS } from "../page/meta";

export type { PageIndexCandidate } from "./types";

/** The flags the rule reads (a full PageIndexCandidate satisfies this). */
export type IndexableFlags = {
  inManifest: boolean;
  hasRow: boolean;
  protected: boolean;
  held: boolean;
  kind: string;
  addonHidden: boolean;
};

/** True only for a published, row-backed, unprotected, unheld, visible, non-system page. */
export function isIndexablePage(c: IndexableFlags): boolean {
  if (c.inManifest !== true) return false;
  if (c.hasRow !== true) return false;
  if (c.protected !== false) return false;
  if (c.held !== false) return false;
  if (c.addonHidden !== false) return false;
  if (typeof c.kind === "string" && NOINDEX_PAGE_KINDS.includes(c.kind)) {
    return false;
  }
  return true;
}

/** A record is kept only when its path (without `#fragment`) is an indexable page's path. */
export function recordTargetsIndexablePage(
  path: string,
  indexablePaths: ReadonlySet<string>,
): boolean {
  if (typeof path !== "string") return false;
  const hash = path.indexOf("#");
  const bare = hash === -1 ? path : path.slice(0, hash);
  return indexablePaths.has(bare);
}
