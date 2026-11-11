// Read the public site index (07-31 choice 3; CONT-37, D277; invariant 1). SiteContext only:
// the key is built from the minted site's org id, so org B's host never reads org A's file.
// Absent or malformed -> null (deny by default through parseSiteIndex).
import { parseSiteIndex, type SiteIndex } from "@cds/core/seo";
import {
  getObjectStore,
  tenantSiteIndexKey,
  type ObjectStore,
} from "../../storage";
import { readJson } from "../manifest";
import { assertSiteContext, type SiteContext } from "../site-context";

export async function readSiteIndex(
  site: SiteContext,
  store?: ObjectStore,
): Promise<SiteIndex | null> {
  assertSiteContext(site);
  const s = store ?? getObjectStore();
  return parseSiteIndex(await readJson(s, tenantSiteIndexKey(site.orgId)));
}
