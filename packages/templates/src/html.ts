// P8 (08-12): small html helpers for slot fills (T-08-12-01, T-08-12-02). Every piece of
// intake text that becomes markup goes through escapeHtml here; saveSection's mapRichText
// sanitizes again on save. Pure: no React, no database client.
import { escapeHtml } from "@cds/core/email";

const BLANK_LINE = /\r?\n\s*\r?\n/;

function paragraphsOf(text: unknown): string[] {
  if (typeof text !== "string") return [];
  return text
    .split(BLANK_LINE)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** Blank-line separated text as escaped `<p>` paragraphs; single breaks become `<br>`. */
export function paragraphs(text: string): string {
  return paragraphsOf(text)
    .map(
      (p) =>
        `<p>${p
          .split(/\r?\n/)
          .map((line) => escapeHtml(line.trim()))
          .join("<br>")}</p>`,
    )
    .join("");
}

const SENTENCE_END = new Set([".", "!", "?"]);

/**
 * The first paragraph, at most `max` characters (D-UI-P8-20): cut at the last sentence end
 * (`.`, `!`, `?`) at or before `max`; failing that at the last word boundary; a single word
 * longer than `max` is hard-cut. Never adds an ellipsis. Plain text (escape at render).
 */
export function excerpt(text: string, max: number): string {
  const first = paragraphsOf(text)[0] ?? "";
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  if (first.length <= limit) return first;
  const window = first.slice(0, limit);
  for (let i = window.length - 1; i >= 0; i--) {
    const next = first[i + 1];
    if (
      SENTENCE_END.has(window[i]!) &&
      (next === undefined || /\s/.test(next))
    ) {
      return window.slice(0, i + 1);
    }
  }
  const space = window.search(/\s\S*$/);
  if (space > 0) return window.slice(0, space).trimEnd();
  return window;
}

/**
 * "tel:" href from a displayed phone: the one shared core helper (digits with a leading +,
 * an extension as `;ext=`; "" when no digits). The ui site renderer uses the same one
 * (08-REVIEW CR-B02).
 */
export { telHref } from "@cds/core/content";
