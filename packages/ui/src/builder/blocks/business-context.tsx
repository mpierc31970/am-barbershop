"use client";
// Builder business context (07-24 choice 10; CONT-24, CONT-27, D119, D253). The builder
// route reads getBusinessProfile once and Builder.tsx wraps its tree in
// BuilderBusinessProvider; the Map, Hours and Social editors and the Suggested presets read
// it with useBuilderBusiness(). Editors get no new props, so CoreBlockEditorProps is
// unchanged (same rule as 07-18's FormOptionsProvider). Outside a provider the hook returns
// null and the editors still render (without the "comes from Settings" details).
// Only the fields below cross to the client (T-07-24-07): no ga4, legal or private fields.
// 08-05 adds publishedServices (a count) and email (the already-public business email);
// both are public data, so the rule holds (T-08-05-03).
import { createContext, useContext, type ReactNode } from "react";

export type BuilderBusiness = {
  name: string;
  phone: string;
  /** The formatted business address ("12 Main St, Austin, TX 78701"), or "". */
  addressText: string;
  /** Some day has opening hours. */
  hasHours: boolean;
  socials: readonly { platform: string; url: string }[];
  /** onboarding business type id, or "". */
  businessType: string;
  /** count of published services for the Services block count line; filled by the builder route, 08-08 */
  publishedServices?: number;
  /** public business email for the Contact preset, 08-01/08-08 */
  email?: string;
};

const BuilderBusinessContext = createContext<BuilderBusiness | null>(null);

export function BuilderBusinessProvider({
  value,
  children,
}: {
  value: BuilderBusiness | null;
  children?: ReactNode;
}) {
  return (
    <BuilderBusinessContext.Provider value={value}>
      {children}
    </BuilderBusinessContext.Provider>
  );
}

/** The org's business details for the editors, or null outside a provider. */
export function useBuilderBusiness(): BuilderBusiness | null {
  return useContext(BuilderBusinessContext);
}

/** Settings links the editors point to (hub settings tabs, P6). */
export const BUSINESS_INFO_HREF = "/hub/settings?tab=business";
export const TEAM_HOURS_HREF = "/hub/settings?tab=team-hours";
/** Website › Services tab (08-05; tab id from apps/web hub/website/tabs.ts). */
export const SERVICES_HREF = "/hub/website?tab=services";

export const SETTINGS_LINK_CLASS =
  "font-semibold text-hub-accent underline underline-offset-2";

// ---------------------------------------------------------------------------------------
// Builder plan (10-41; BILL-04, BILL-14, D233, D-UI-P10-26). The builder route computes
// `builderPro` (the org's entitlement set has "builder-pro", 10-17 getEntitlements) and
// `canBuy` (can(ctx, "purchases", "run"): the Owner) on the server; Builder.tsx provides them
// here. Editors read useBuilderPlan() to unlock Pro options or render the shared locks
// (FeatureGuard / FeatureInline). Never fetched on the client (CONTEXT A3); the server
// re-checks the plan on every save (assertTablePlan), so a tampered value only unlocks UI.

export type BuilderPlan = {
  /** The org has Builder Pro right now (bought, or included on the Studio path). */
  builderPro: boolean;
  /** The member may buy add-ons (the Owner): the locks show "Add Builder Pro". */
  canBuy: boolean;
};

/** Outside a provider: no Builder Pro, no buy link (the safe default). */
export const NO_BUILDER_PLAN: BuilderPlan = Object.freeze({
  builderPro: false,
  canBuy: false,
});

const BuilderPlanContext = createContext<BuilderPlan>(NO_BUILDER_PLAN);

export function BuilderPlanProvider({
  value,
  children,
}: {
  value: BuilderPlan;
  children?: ReactNode;
}) {
  return (
    <BuilderPlanContext.Provider value={value}>
      {children}
    </BuilderPlanContext.Provider>
  );
}

/** The org's Builder Pro state for the editors; NO_BUILDER_PLAN outside a provider. */
export function useBuilderPlan(): BuilderPlan {
  return useContext(BuilderPlanContext);
}
