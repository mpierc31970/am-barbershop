// Autolink (12-09 choice 2; T-12-09-01). Splits plain message text into text and URL tokens.
// Only `http://` and `https://` become links (never `javascript:`, `data:` or anything a
// browser would run). The caller renders tokens as React text and `<a>` elements, so no
// markup from a message body ever reaches the DOM as HTML.

export type AutolinkToken =
  { kind: "text"; text: string } | { kind: "url"; text: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?'"\]]$/;

/** Drop trailing punctuation and an unbalanced closing parenthesis from a match. */
function trimUrl(raw: string): string {
  let s = raw;
  for (;;) {
    if (TRAILING.test(s)) {
      s = s.slice(0, -1);
      continue;
    }
    if (s.endsWith(")")) {
      const open = (s.match(/\(/g) ?? []).length;
      const close = (s.match(/\)/g) ?? []).length;
      if (close > open) {
        s = s.slice(0, -1);
        continue;
      }
    }
    return s;
  }
}

function safeHref(text: string): string | null {
  try {
    const u = new URL(text);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return text;
  } catch {
    return null;
  }
}

export function autolinkTokens(input: string): AutolinkToken[] {
  const text = typeof input === "string" ? input : "";
  const out: AutolinkToken[] = [];
  let last = 0;
  const push = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === "text") prev.text += t;
    else out.push({ kind: "text", text: t });
  };
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = trimUrl(m[0]);
    const href = url ? safeHref(url) : null;
    if (!href) continue;
    push(text.slice(last, start));
    out.push({ kind: "url", text: url, href });
    last = start + url.length;
  }
  push(text.slice(last));
  return out;
}
