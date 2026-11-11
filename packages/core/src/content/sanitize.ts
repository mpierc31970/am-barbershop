// Rich-text sanitizer (CONT-09, CONTEXT A3-Q3, D188). The one security primitive the block
// save, publish and public render paths all call on tenant-authored rich text.
//
// Node-only: never re-export from packages/core/src/index.ts (Edge middleware imports it).
// Reach it only through the "@cds/core/content/sanitize" subpath (RESEARCH Pitfall 1,
// tests/edge-boundary.test.ts).
//
// DOM-free on purpose: sanitize-html (htmlparser2) runs identically in server actions,
// publish and RSC render, with no jsdom and no fail-open "no DOM" branch. The donor used
// DOMPurify, which needs a DOM and therefore returned "" on the server.
//
// Allowlist decisions (03-01, resolves RESEARCH Open Question 1):
// - `ol` is adopted on top of the donor's seven tags (ordered lists in the toolbar).
// - Rich-text links are omitted: not in the donor set, and links live on Button, Hero,
//   CTA and banner fields where safeHref validates them (03-02). This overrides the
//   UI-SPEC "Link (if in donor set)" toolbar entry.
// Zero attributes on every tag removes href, style, on* handlers and the id/name
// DOM-clobbering surface in one stroke.
import sanitizeHtml from "sanitize-html";

export const RICH_TEXT_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "ul",
  "ol",
  "li",
] as const;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
  allowedAttributes: {},
  allowedSchemes: [],
  allowedSchemesAppliedToAttributes: [],
  allowProtocolRelative: false,
  // Disallowed elements are unwrapped (text kept). script/style/textarea/option content is
  // dropped entirely via sanitize-html's default nonTextTags, left untouched here.
  disallowedTagsMode: "discard",
  allowVulnerableTags: false,
  parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
};

// Legal HTML (P9, RESEARCH Pitfall 8, T-09-01-01): the defence-in-depth pass over
// renderLegalMarkdown output (signed copies, /legal/*, tenant policy pages). Its own
// allowlist so the rich-text one above is never loosened. Links keep only href, and only
// https/mailto; every other attribute (on*, style, id) is dropped.
export const LEGAL_ALLOWED_TAGS = [
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "a",
] as const;

const LEGAL_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...LEGAL_ALLOWED_TAGS],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  allowVulnerableTags: false,
  parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
};

/** Sanitize legal HTML to the legal allowlist. Non-string or empty input yields "". */
export function sanitizeLegalHtml(html: string): string {
  if (typeof html !== "string" || html === "") return "";
  return sanitizeHtml(html, LEGAL_OPTIONS);
}

/** Sanitize arbitrary input to the allowlist. Non-string or empty input yields "". */
export function sanitizeRichText(html: unknown): string {
  if (typeof html !== "string" || html === "") return "";
  return sanitizeHtml(html, OPTIONS);
}
