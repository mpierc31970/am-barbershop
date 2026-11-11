// @cds/addon-registry/admin: add-on hub panels and block forms (ADDON-02; RESEARCH
// Pattern 1). Client modules: import from the client/RSC tree, never pass these components
// as props from server data.
import type { ComponentType } from "react";
import { ADMIN_MODULES } from "./generated/admin";
import type { AddonAdminModule } from "./types";

export type { AddonAdminModule } from "./types";

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

/** Admin module per slug. */
export const ADDON_ADMIN: Readonly<Record<string, AddonAdminModule>> =
  ADMIN_MODULES;

/* eslint-disable @typescript-eslint/no-explicit-any -- forms are typed per add-on */
/** The add-on's nav tab panel; own-property lookup only. */
export function addonPanel(slug: unknown): ComponentType<any> | undefined {
  if (typeof slug !== "string" || !hasOwn(ADDON_ADMIN, slug)) return undefined;
  return ADDON_ADMIN[slug]!.Panel;
}

/** The block form for an add-on section type; own-property lookups only. */
export function addonBlockForm(
  sectionType: unknown,
): ComponentType<any> | undefined {
  if (typeof sectionType !== "string") return undefined;
  for (const slug of Object.keys(ADDON_ADMIN)) {
    const forms = ADDON_ADMIN[slug]!.blockForms;
    if (hasOwn(forms, sectionType)) return forms[sectionType];
  }
  return undefined;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
