// The testimonials collection registry entry (ADDON-03, TEN-03, LIFE-03; D187; invariants 1
// and 3). The collection ships in the schema from day one (migrations/) and sits empty until
// the add-on is on. Writes are "custom": they go through addonRepo (scan, holds, lock).
// Visitors read the public fields only (deny by default): never organization, source or
// is_published.
import type { CollectionSpec } from "@cds/core";

export const TESTIMONIALS_COLLECTIONS = {
  testimonials: {
    kind: "base",
    feature: "addon:testimonials",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "quote",
      "author_name",
      "author_detail",
      "rating",
      "photo_url",
      "photo_alt",
      "source",
      "featured",
      "is_published",
      "sort_order",
      "created",
      "updated",
    ],
    filterable: [
      "id",
      "featured",
      "is_published",
      "sort_order",
      "source",
      "created",
      "updated",
    ],
    public: [
      "id",
      "quote",
      "author_name",
      "author_detail",
      "rating",
      "photo_url",
      "photo_alt",
      "featured",
      "sort_order",
    ],
  },
} as const satisfies Record<string, CollectionSpec>;
