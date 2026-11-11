// Plain text from rich-text html (ported from donor DCR-Website src/lib/rich-text.ts
// htmlToPlainText / isRichTextEmpty), made DOM-free so it runs on the server, in the Edge
// runtime and in unit tests alike. Used for block preview lines, pop-up names and the
// empty-content checks. Output is plain text for display as text, never as html.

const BLOCK_BREAK =
  /<\/?(?:p|div|br|li|ul|ol|h[1-6]|blockquote|pre|tr|td|th|section|article|hr)\b[^>]*>/gi;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  // One pass, so "&amp;lt;" decodes to "&lt;" and not "<".
  return s.replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi,
    (whole, body: string) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
          return whole;
        }
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return NAMED[body.toLowerCase()] ?? whole;
    },
  );
}

/** Tags stripped, block boundaries turned into whitespace, entities decoded, whitespace collapsed. */
export function htmlToPlainText(html: string): string {
  if (typeof html !== "string" || html === "") return "";
  const stripped = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(BLOCK_BREAK, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(stripped)
    .replace(/[\s ]+/g, " ")
    .trim();
}

/** True when the html has no visible text and no image (e.g. "<p></p>", "<p><br></p>"). */
export function isRichTextEmpty(html: string): boolean {
  if (typeof html === "string" && /<img\b/i.test(html)) return false;
  return htmlToPlainText(html) === "";
}
