// Live title and description suggestions (07-30; CONT-14, D188). Used by the tenant
// metadata when a page has no title or description of its own, and shown in the SEO drawer.
// Re-exported from checklist.ts (the plan's public home for them).
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import { htmlToPlainText } from "../../content/plain-text";
import { ownString, sectionItems, visibleSections } from "./content-walk";

export const SEO_LIMITS = Object.freeze({
  title: 60,
  description: 160,
  suggestion: 155,
});

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** "<Page title> | <Business>"; the home page is just the business name. */
export function suggestTitle(
  pageTitle: string,
  businessName: string,
  opts: { isHome?: boolean } = {},
): string {
  const title = str(pageTitle).trim();
  const name = str(businessName).trim();
  if (opts.isHome || title === "") return name || title;
  if (name === "" || title === name) return title;
  return `${title} | ${name}`;
}

function cutAtSpace(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const at = head.lastIndexOf(" ");
  return (at > 0 ? head.slice(0, at) : text.slice(0, max)).trimEnd();
}

/** The first text in page order (hidden blocks skipped), plain, cut at a space <= 155. */
export function suggestDescription(sections: readonly unknown[]): string {
  for (const s of visibleSections(sections)) {
    let html = "";
    try {
      if (s.section_type === "text-only" || s.section_type === "text-image") {
        html = ownString(s.content, "text");
      } else {
        for (const item of sectionItems(s)) {
          if (item.kind === "text" && htmlToPlainText(str(item.html)) !== "") {
            html = str(item.html);
            break;
          }
        }
      }
    } catch {
      html = "";
    }
    const plain = htmlToPlainText(html);
    if (plain !== "") return cutAtSpace(plain, SEO_LIMITS.suggestion);
  }
  return "";
}
