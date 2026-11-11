// The org's entitlement set for hub server components (10-17; BILL-03, BILL-04, BILL-14;
// CONTEXT A3). Cached 60 seconds under `org:<id>:addons` (addonsTag): the installer and the
// billing handlers revalidate that tag, and the TTL bounds anything else (T-10-17-03).
// Gates that change data re-check hasEntitlement server-side; this read only shapes the UI.
// Server-only; the client never fetches it.
import { addonsTag, entitlements, type OrgContext } from "@cds/db";
import { unstable_cache } from "next/cache";

const ENTITLEMENTS_REVALIDATE_S = 60;

/** Serializable form of EntitlementSet (unstable_cache stores JSON). */
export type EntitlementsView = {
  keys: string[];
  mediaPacks5: number;
  mediaPacks25: number;
  pagePacks: number;
};

export function getEntitlements(ctx: OrgContext): Promise<EntitlementsView> {
  return unstable_cache(
    async (): Promise<EntitlementsView> => {
      const set = await entitlements(ctx);
      return {
        keys: [...set.keys].sort(),
        mediaPacks5: set.mediaPacks5,
        mediaPacks25: set.mediaPacks25,
        pagePacks: set.pagePacks,
      };
    },
    ["entitlements", ctx.orgId],
    {
      tags: [addonsTag(ctx.orgId)],
      revalidate: ENTITLEMENTS_REVALIDATE_S,
    },
  )();
}
