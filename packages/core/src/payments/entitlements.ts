// Entitlement keys (BILL-03, D225, D299). An entitlement is an add-on registry slug or one of
// the core, non-add-on keys below. Pure.

/** Entitlements that are not add-ons: the optional Care Plan and media storage packs. */
export const CORE_ENTITLEMENTS = ["care-plan", "media-pack"] as const;

export type CoreEntitlementKey = (typeof CORE_ENTITLEMENTS)[number];

/** S is the add-on slug union when the caller has it; any string otherwise. */
export type EntitlementKey<S extends string = string> = S | CoreEntitlementKey;

/** What one org may use right now (entitlements(ctx) in packages/db/src/payments returns it). */
export type EntitlementSet = {
  keys: ReadonlySet<string>;
  /** Quantity of 5 GB media packs on the subscription (D225). */
  mediaPacks5: number;
  /** Quantity of 25 GB media packs on the subscription (D225). */
  mediaPacks25: number;
  /** Quantity of "5 more pages" packs on the subscription (D185); 0 while paused. */
  pagePacks: number;
};
