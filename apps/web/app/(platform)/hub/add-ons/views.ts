// Server-side view building for Get add-ons (ADDON-05, ADDON-07, ADDON-09). Turns a manifest
// plus the org's add-on state into the plain AddonView the client pieces render. Server-only
// (reads the session's site host); the copy itself comes from catalog-logic. P10 (10-31) adds
// the catalog price label and the paused flag.
import type { OrgContext } from "@cds/db";
import type { AddonManifest, AddonRegistry } from "@cds/core/addons";
import { addonHref } from "../nav";
import type { AddonView } from "./AddonActions";
import {
  addDialogCopy,
  availability,
  errAddCopy,
  errRemoveCopy,
  namesOf,
  pausedAddonCopy,
  pluralOf,
  removeCopy,
} from "./catalog-logic";

export function detailHref(slug: string): string {
  return `/hub/add-ons/${encodeURIComponent(slug)}`;
}

export function buildView(input: {
  manifest: AddonManifest;
  ctx: OrgContext;
  active: readonly string[];
  retained: number;
  pageUrl: string | null;
  registry: AddonRegistry;
  /** Catalog price label for the org's path; null = not priced yet (10-31). */
  priceLabel: string | null;
  /** Disabled by a billing lapse (10-31, BILL-03). */
  paused: boolean;
  /** Remove dialog bill line (removeBillLine); null when nothing is billed. */
  removeBill?: string | null;
  /** 13-32: the catalog listing says coming soon (shown, never added). */
  comingSoon?: boolean;
}): AddonView {
  const { manifest: m, ctx, registry } = input;
  const a = availability({
    manifest: m,
    active: input.active,
    role: ctx.role,
    impersonating: Boolean(ctx.impersonator),
    registry,
  });
  return {
    slug: m.slug,
    name: m.name,
    plural: pluralOf(m),
    href: detailHref(m.slug),
    manageHref: addonHref(m),
    pageUrl: input.pageUrl,
    active: input.active.includes(m.slug),
    priceLabel: input.priceLabel,
    paused: input.paused && !input.active.includes(m.slug),
    state: a.state,
    missing: namesOf(a.missing, registry),
    add: addDialogCopy(m, input.retained),
    remove: removeCopy(m),
    errAdd: errAddCopy(m.name),
    errRemove: errRemoveCopy(m.name),
    pausedCopy: pausedAddonCopy(m.name, pluralOf(m)),
    removeBill: input.removeBill ?? null,
    comingSoon: input.comingSoon === true && !input.active.includes(m.slug),
  };
}
