// Visitor reads for site chrome that live outside site-context.ts (07-25 choice 8; like
// 07-12's media/library/resolve.ts). SiteContext-gated (minted only from a resolved host),
// superuser read filtered to the site's org, id only (T-07-25-08).
import { withSuperuser } from "../../client";
import { assertSiteContext, type SiteContext } from "../site-context";

/** The org's current logo asset id (kind logo, ready, active), newest first; null if none. */
export async function readPublicLogoId(
  site: SiteContext,
): Promise<string | null> {
  assertSiteContext(site);
  const res = await withSuperuser((pb) =>
    pb.collection("media_assets").getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && kind = 'logo' && status = 'ready' && removed_at = '' && deleted_at = ''",
        { org: site.orgId },
      ),
      sort: "-created,-id",
      fields: "id",
    }),
  );
  const row = res.items[0];
  return row && typeof row.id === "string" ? row.id : null;
}
