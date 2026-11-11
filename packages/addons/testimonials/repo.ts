// Testimonials repository (ADDON-06; invariants 1 and 4). A typed wrapper over the @cds/db
// chokepoint: addonRepo reaches only this add-on's declared collections, checks
// addon:testimonials, scopes every query to the context's org and screens every save.
// Org context arrives as a parameter; this package never holds a database client.
import { addonRepo, type AddonCollectionRepo } from "@cds/db";

type AddonDeps = Parameters<typeof addonRepo>[1];
type OrgContext = Parameters<typeof addonRepo>[0];

export function testimonialsRepo(
  ctx: OrgContext,
  deps: AddonDeps,
): AddonCollectionRepo {
  return addonRepo(ctx, deps, "testimonials").collection("testimonials");
}
