// Inline feature lock (10-07; BILL-04, BILL-14, 10-UI-SPEC "Feature locks", LOCK-INLINE).
// For an option, field type or toggle. Render-prop: the caller receives `locked` and
// disables its own control. When locked this adds the P7 pro badge (Lock 14, "Part of
// {name}") and, for an owner, a link "Add {name}"; everyone else reads "Ask your site owner
// to add {name}." The entitlement set comes from a server component (CONTEXT A3); this
// component never fetches.
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import type { HubLinkComponent } from "./AddonCard";
import { featureBuyHref } from "./FeatureGuard";

/** 10-UI-SPEC LOCK-INLINE, non-owner line. */
export function askOwnerCopy(featureName: string): string {
  return `Ask your site owner to add ${featureName}.`;
}

export interface FeatureInlineProps {
  feature: string;
  entitlements: ReadonlySet<string>;
  featureName: string;
  canBuy: boolean;
  buyHref?: string;
  LinkComponent?: HubLinkComponent;
  children: (locked: boolean) => ReactNode;
}

export function FeatureInline({
  feature,
  entitlements,
  featureName,
  canBuy,
  buyHref,
  LinkComponent,
  children,
}: FeatureInlineProps) {
  const locked = !entitlements.has(feature);
  if (!locked) return <>{children(false)}</>;
  const Link = LinkComponent ?? "a";
  return (
    <div className="flex flex-col gap-1" data-feature-lock={feature}>
      {children(true)}
      <div className="flex flex-wrap items-center gap-2 px-2 font-hub text-sm">
        <span className="inline-flex items-center gap-1 rounded bg-hub-surface-2 px-2 py-1 font-semibold text-hub-ink-muted">
          <Lock aria-hidden size={14} strokeWidth={2} />
          Part of {featureName}
        </span>
        {canBuy ? (
          <Link
            href={buyHref ?? featureBuyHref(feature)}
            className="inline-flex min-h-11 items-center font-semibold text-hub-ink underline underline-offset-4"
          >
            Add {featureName}
          </Link>
        ) : (
          <span className="text-hub-ink-muted">
            {askOwnerCopy(featureName)}
          </span>
        )}
      </div>
    </div>
  );
}
