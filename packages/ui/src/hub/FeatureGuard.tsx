// Panel-level feature lock (10-07; BILL-04, D42, 10-UI-SPEC "Feature locks", D-UI-P10-17).
// Built fresh against the registry: `feature` is a registry add-on slug or a core
// entitlement key, and `entitlements` is the set the SERVER computed (CONTEXT A3). This
// component never fetches and never decides: it only renders what the server decided. The
// server still checks `hasEntitlement` on every write (10-17), so a locked UI is cosmetic.
//
// Not entitled: the `fallback`, by default a panel (hub-surface-2, 24px padding, 8px
// radius) with Lock 16 + "Part of {name}" + LOCK-PANEL + an owner link "Add {name}". Never a
// blurred or greyed preview of the locked UI: the children are not rendered at all.
import { Lock } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { HubLinkComponent } from "./AddonCard";

/** 10-UI-SPEC LOCK-PANEL. */
export function lockPanelCopy(featureName: string): string {
  return `Add ${featureName} to use this. Everything you set up here is kept if you ever remove it.`;
}

/** Default upsell target: the add-on's detail page. */
export function featureBuyHref(feature: string): string {
  return `/hub/add-ons/${encodeURIComponent(feature)}`;
}

export interface FeatureGuardProps {
  /** Registry add-on slug or core entitlement key. */
  feature: string;
  /** Server-computed entitlement set; never fetched on the client. */
  entitlements: ReadonlySet<string>;
  /** Display name of the add-on, e.g. "Builder Pro". */
  featureName: string;
  /** Owner only: shows the "Add {name}" link. */
  canBuy: boolean;
  /** Defaults to /hub/add-ons/<feature>. */
  buyHref?: string;
  /** Replaces the default lock panel. */
  fallback?: ReactNode;
  /** next/link from the app; a plain <a> by default. */
  LinkComponent?: HubLinkComponent;
  children: ReactNode;
}

export function FeatureGuard({
  feature,
  entitlements,
  featureName,
  canBuy,
  buyHref,
  fallback,
  LinkComponent,
  children,
}: FeatureGuardProps) {
  const headingId = useId();
  if (entitlements.has(feature)) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  const Link = LinkComponent ?? "a";
  return (
    <section
      aria-labelledby={headingId}
      data-feature-lock={feature}
      className="flex flex-col gap-2 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      <p
        id={headingId}
        className="flex items-center gap-2 text-base font-semibold"
      >
        <Lock aria-hidden size={16} strokeWidth={2} />
        Part of {featureName}
      </p>
      <p className="text-base text-hub-ink-muted">
        {lockPanelCopy(featureName)}
      </p>
      {canBuy ? (
        <Link
          href={buyHref ?? featureBuyHref(feature)}
          className="inline-flex min-h-11 items-center self-start text-base font-semibold text-hub-ink underline underline-offset-4"
        >
          Add {featureName}
        </Link>
      ) : null}
    </section>
  );
}
