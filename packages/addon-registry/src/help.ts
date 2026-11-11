// @cds/addon-registry/help (11-46; DASH-17, D110; RESEARCH Pattern 14). Server-side Help
// center data: every docs/how-to/*.md (except TEMPLATE and README) baked at codegen, so the
// standalone image serves help without docs/ (`addons:check` fails on drift). Kept out of the
// pure "." entry, which the client builder bundles: only server pages read this module, and
// they pass plain step data to client components. Which articles a person may open is decided
// by apps/web/lib/help-index.ts; this module is just the content.
import { HELP_ARTICLES, type HelpArticleData } from "./generated/help";

export type { HelpArticleData } from "./generated/help";

/** The baked article for a how-to path (docs/how-to/<file>.md), or null when unknown. */
export function helpArticle(howTo: string): HelpArticleData | null {
  if (typeof howTo !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(HELP_ARTICLES, howTo)) return null;
  return HELP_ARTICLES[howTo]!;
}

/** Every baked how-to path, sorted. */
export function helpArticlePaths(): string[] {
  return Object.keys(HELP_ARTICLES).sort();
}
