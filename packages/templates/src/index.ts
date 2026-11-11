// @cds/templates (P8; TMPL-01..03): site templates as data, selected by the org's path.
//
// How to add a template (TMPL-03):
//   1) write any new slots in src/slots as pure `Slot` objects using only registered
//      section types and preset builders;
//   2) add a `SiteTemplate` (unique id, version 1, paths, pages with a `home` page) in its
//      own file;
//   3) append it to TEMPLATES;
//   4) add its fixture run to templates.test.ts.
// The provisioner (`assembleSite` in @cds/db) receives TEMPLATES by injection and needs no
// change. Bump `version` when slot output changes; re-runs rebuild only untouched pages.
import { pickTemplate, type SiteTemplate } from "@cds/core/templates";
import { STANDARD_V1 } from "./standard-v1";

export const packageName = "@cds/templates";

export { STANDARD_V1 };
export { readFacts } from "./facts";
export * from "./slots/index";

/** Every shipped template; v1.0 has one (the Shop template is v1.1). */
export const TEMPLATES: readonly SiteTemplate[] = Object.freeze([STANDARD_V1]);

/** The template for an org path; undefined when none lists it (e.g. "shop"). */
export function templateFor(path: string): SiteTemplate | undefined {
  return pickTemplate(TEMPLATES, path);
}
