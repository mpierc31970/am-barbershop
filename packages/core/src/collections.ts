// CollectionSpec: the shape of one tenant collection's registry entry (TEN-01, TEN-03,
// LIFE-03; D5, D187, D284). Lives in @cds/core (type only) so pure add-on manifests can
// declare their collections without naming @cds/db (ADDON-01, CONTEXT A1-Q2). @cds/db
// imports and re-exports it. Pure and Edge-safe.

export type CollectionSpec = {
  kind: "base" | "auth" | "append-only";
  /** Permission-matrix feature checked by the repository (D285). */
  feature: string;
  export: readonly string[] | "never";
  /**
   * Plain fields a caller may filter and sort on through tenantRepo().list (CR-02). Defaults
   * to the export list; required for "never"-exported collections that should be filterable.
   * Never a hidden, secret or auth field.
   */
  filterable?: readonly string[];
  /** Renter contexts only see rows whose ownerField equals their actor (TEN-14). */
  ownerField?: string;
  /**
   * Per-person rows (P11 Pitfall 6): EVERY org context, not just renters, only sees rows
   * whose ownerField equals its actor, so a colleague's prefs, alerts or devices are
   * NotFound. Requires ownerField (fail closed).
   */
  personal?: true;
  /** "generic": tenantRepo exposes create/update/delete. "custom": read-only here; writes live in a dedicated module. */
  writes: "generic" | "custom";
  organizationOptional?: boolean;
  /**
   * skip: never deleted and never created by tenants:restore; bundle rows are ignored
   * (append-only legal evidence, P9 RESEARCH Pitfall 2).
   */
  restore?: "replace" | "append-missing" | "skip";
  /**
   * Fields a SiteContext may read for anonymous visitors (D187, CONTEXT A3-Q1). Deny by
   * default: a collection without a list exposes nothing to visitors, and no secret field
   * may ever be named here.
   */
  public?: readonly string[];
  /**
   * Owner-gated public fields (B-WR-04, D187): `{ field: gate }` means `field` (which must be
   * in `public`) reaches visitors only when the row's boolean `gate` field is true; otherwise
   * it reads as null. Enforced at the chokepoint, so no visitor-side consumer can leak a value
   * the owner chose to hide (Credentials: the number unless Show number is on).
   */
  publicWhen?: Readonly<Record<string, string>>;
  /**
   * Row-level deny by default (12-04, D187, CONTEXT Area 1): `{ field, equals }` means only
   * rows whose `field` equals `equals` ever leave the server through a generic reader. The
   * repository list/get, the tenant export bundle, Download my data and toSnapshot all apply
   * it, so an internal support note can never reach a tenant through any of them. `field`
   * must be in the export list (registry test). Staff-only reads live in custom modules.
   */
  rowFilter?: Readonly<{ field: string; equals: string }>;
};
