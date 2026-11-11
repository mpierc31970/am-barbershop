// The Next-backed Invalidator (CONT-31, D253; RESEARCH Pattern 4). @cds/db never imports
// next/*: it calls this port with org-scoped tags (siteTag, pageTag, liveTag) after a
// publish, restore or live save, and this drops the matching unstable_cache entries.
import type { Invalidator } from "@cds/db";
import { revalidateTag } from "next/cache";

export const nextInvalidator: Invalidator = {
  invalidate(tags: string[]) {
    tags.forEach((tag) => revalidateTag(tag));
  },
};
