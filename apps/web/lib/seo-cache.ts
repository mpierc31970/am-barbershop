// Cached SEO reads for tenant pages (07-30; CONT-13, CONT-28; D188, D253). Kept apart from
// site-cache.ts (07-31 edits that one). Each read is tagged liveTag(org) with a 60 s
// revalidate and never throws: a failure is logged and the page renders without that part.
import {
  liveTag,
  readPublicServices,
  readPublicTeam,
  readSiteIcons,
  type PublicService,
  type PublicTeamMember,
  type SiteContext,
  type SiteIcons,
} from "@cds/db";
import { unstable_cache } from "next/cache";

const SEO_REVALIDATE_S = 60;

/** The generated icon set ({ v, source }) or null (none yet, or the read failed). */
export function getSiteIcons(site: SiteContext): Promise<SiteIcons | null> {
  return unstable_cache(
    async () => {
      try {
        return await readSiteIcons(site);
      } catch {
        console.error("[seo] site icons read failed");
        return null;
      }
    },
    ["site-icons", site.orgId],
    { tags: [liveTag(site.orgId)], revalidate: SEO_REVALIDATE_S },
  )();
}

export type PublicRecords = {
  services: PublicService[];
  team: PublicTeamMember[];
};

/** Published services and team for JSON-LD; empty lists when the read fails. */
export function getPublicRecords(site: SiteContext): Promise<PublicRecords> {
  return unstable_cache(
    async () => {
      const [services, team] = await Promise.all([
        readPublicServices(site).catch(() => {
          console.error("[seo] services read failed");
          return [] as PublicService[];
        }),
        readPublicTeam(site).catch(() => {
          console.error("[seo] team read failed");
          return [] as PublicTeamMember[];
        }),
      ]);
      return { services, team };
    },
    ["public-records", site.orgId],
    { tags: [liveTag(site.orgId)], revalidate: SEO_REVALIDATE_S },
  )();
}

/** `/_site/<file>?v=<v>` for a generated file, or null when nothing is generated. */
export function siteAssetHref(
  icons: SiteIcons | null,
  file: "icon-32.png" | "icon-180.png" | "icon-512.png" | "share.png",
): string | null {
  return icons ? `/_site/${file}?v=${icons.v}` : null;
}
