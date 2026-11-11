// The credentials collection registry entry (ADDON-03, TEN-03, LIFE-03; D187; invariants 1
// and 3; T-05-45, T-05-46). The collection ships in the schema from day one (migrations/)
// and sits empty until the add-on is on. Writes are "custom": they go through addonRepo
// (scan, holds, lock). Visitors read the public fields only (deny by default): never
// organization or is_published. credential_number is public only when the row's show_number
// is on: publicWhen gates it at the chokepoint, so every visitor read gets null for a hidden
// number (B-WR-04, D187). blockData also drops it unless show_number is on (D-UI-P5-14).
import type { CollectionSpec } from "@cds/core";

export const CREDENTIALS_COLLECTIONS = {
  credentials: {
    kind: "base",
    feature: "addon:credentials",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "title",
      "issuer",
      "category",
      "credential_number",
      "show_number",
      "issued_on",
      "expires_on",
      "verify_url",
      "is_published",
      "sort_order",
      "created",
      "updated",
    ],
    filterable: [
      "id",
      "category",
      "is_published",
      "sort_order",
      "expires_on",
      "created",
      "updated",
    ],
    public: [
      "id",
      "title",
      "issuer",
      "category",
      "credential_number",
      "show_number",
      "issued_on",
      "expires_on",
      "verify_url",
      "sort_order",
    ],
    publicWhen: { credential_number: "show_number" },
  },
} as const satisfies Record<string, CollectionSpec>;
