// The price catalog for /start (ONB-06; RESEARCH Pattern 3). Every visitor sees the same
// public prices, so the read is cached for 60 seconds under the "price-catalog" tag: a
// `prices:set` change shows on the page's next load after that ("on its next load").
// The chokepoint (readPriceCatalog) returns no ids or notes. Server-only.
import type { CatalogRow } from "@cds/core/pricing";
import { readPriceCatalog } from "@cds/db";
import { unstable_cache as cached } from "next/cache";

export const getCatalog: () => Promise<CatalogRow[]> = cached(
  async () => readPriceCatalog(),
  ["price-catalog"],
  { revalidate: 60, tags: ["price-catalog"] },
);
