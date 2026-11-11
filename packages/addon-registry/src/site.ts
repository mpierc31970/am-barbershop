// @cds/addon-registry/site: every add-on block renderer, keyed by section type (ADDON-02,
// ADDON-08). Server components; never import from a client module.
import { SITE_MODULES } from "./generated/site";
import type { ComponentType } from "react";
import type { AddonSectionProps } from "@cds/ui/site";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- renderers are typed per add-on */
export type AddonSiteRenderer = ComponentType<AddonSectionProps<any, any>>;

/** "./site": one server-rendered block renderer per section type the add-on owns. */
export type AddonSiteModule = {
  renderers: Readonly<Record<string, AddonSiteRenderer>>;
};

function flatten(
  modules: Readonly<Record<string, AddonSiteModule>>,
): Readonly<Record<string, AddonSiteRenderer>> {
  const out: Record<string, AddonSiteRenderer> = Object.create(null);
  for (const [slug, mod] of Object.entries(modules)) {
    for (const [type, renderer] of Object.entries(mod.renderers)) {
      if (Object.prototype.hasOwnProperty.call(out, type)) {
        throw new Error(
          `add-on "${slug}": duplicate site renderer for section type "${type}"`,
        );
      }
      out[type] = renderer;
    }
  }
  return Object.freeze(out);
}

export const ADDON_SITE_RENDERERS: Readonly<Record<string, AddonSiteRenderer>> =
  flatten(SITE_MODULES);
