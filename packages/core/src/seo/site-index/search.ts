// Site search over index.json (07-31 choice 11; CONT-28, CONT-37, D277).
// English sites get stopwords + a small stemmer (stemLite); every other language gets plain
// accent-folded token matching. AND semantics; a term of 3+ chars also prefix-matches.
// Snippets are { text, match } segments so the UI marks words without raw HTML (T-07-31-03).
// Search reads only the index: it cannot see excluded pages (they are never written).
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import type { SiteIndex } from "./types";

export const SEARCH_PER_PAGE = 10;
export const SEARCH_LIMITS = Object.freeze({
  query: 100,
  terms: 8,
  snippet: 160,
});

export const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "we",
  "were",
  "will",
  "with",
  "you",
  "your",
]);

function isEnglish(language: string | undefined): boolean {
  return (language ?? "en").toLowerCase().startsWith("en");
}

/** Ordered suffix rules; the first that applies wins. */
export function stemLite(word: string): string {
  const w = word;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && /(?:s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) {
    return w.slice(0, -1);
  }
  if (w.endsWith("ly") && w.length > 4) return w.slice(0, -2);
  return w;
}

function fold(text: string): string {
  return String(text)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

const SPLIT_RE = /[^\p{L}\p{N}]+/u;

export function tokenize(text: string, language?: string): string[] {
  const en = isEnglish(language);
  const out: string[] = [];
  for (const raw of fold(text).split(SPLIT_RE)) {
    if (raw === "") continue;
    if (raw.length === 1 && !/\p{N}/u.test(raw)) continue;
    if (en) {
      if (ENGLISH_STOPWORDS.has(raw)) continue;
      out.push(stemLite(raw));
    } else {
      out.push(raw);
    }
  }
  return out;
}

/** Trimmed, whitespace-collapsed, at most 100 chars. */
export function normalizeQuery(q: unknown): string {
  const s =
    typeof q === "string" ? q : Array.isArray(q) ? String(q[0] ?? "") : "";
  return s.replace(/\s+/g, " ").trim().slice(0, SEARCH_LIMITS.query).trim();
}

export type SnippetSegment = { text: string; match: boolean };
export type SearchResult = {
  title: string;
  path: string;
  kind: string | null;
  snippet: SnippetSegment[];
};
export type SearchOutcome =
  | { empty: true }
  | {
      empty: false;
      query: string;
      total: number;
      page: number;
      pages: number;
      results: SearchResult[];
    };

function termMatches(token: string, term: string): boolean {
  return token === term || (term.length >= 3 && token.startsWith(term));
}

function anyMatch(
  tokens: readonly string[],
  terms: readonly string[],
): boolean {
  return tokens.some((t) => terms.some((term) => termMatches(t, term)));
}

type Doc = {
  title: string;
  path: string;
  kind: string | null;
  description: string;
  text: string;
  isPage: boolean;
};

function cutWindow(text: string, at: number): string {
  const max = SEARCH_LIMITS.snippet;
  const t = text;
  if (t.length <= max) return t;
  let start = Math.max(0, at - 40);
  if (start > 0) {
    const sp = t.lastIndexOf(" ", start);
    start = sp === -1 ? 0 : sp + 1;
  }
  let end = Math.min(t.length, start + max);
  if (end < t.length) {
    const sp = t.lastIndexOf(" ", end);
    if (sp > start) end = sp;
  }
  const body = t.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < t.length ? "…" : ""}`;
}

function segments(
  text: string,
  terms: readonly string[],
  language: string,
): SnippetSegment[] {
  const out: SnippetSegment[] = [];
  const parts = text.split(/([^\p{L}\p{N}]+)/u);
  for (const part of parts) {
    if (part === "") continue;
    const match =
      /[\p{L}\p{N}]/u.test(part) && anyMatch(tokenize(part, language), terms);
    const last = out[out.length - 1];
    if (last && last.match === match && !match) last.text += part;
    else out.push({ text: part, match });
  }
  return out;
}

function snippetFor(
  doc: Doc,
  terms: readonly string[],
  language: string,
): SnippetSegment[] {
  if (
    doc.description !== "" &&
    anyMatch(tokenize(doc.description, language), terms)
  ) {
    return segments(cutWindow(doc.description, 0), terms, language);
  }
  const text = doc.text.replace(/\s+/g, " ").trim();
  if (text === "") {
    return doc.description === ""
      ? []
      : segments(cutWindow(doc.description, 0), terms, language);
  }
  // first matching word position
  let at = 0;
  const re = /[\p{L}\p{N}]+/gu;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (anyMatch(tokenize(m[0], language), terms)) {
      at = m.index;
      break;
    }
  }
  return segments(cutWindow(text, at), terms, language);
}

export function searchSiteIndex(
  index: SiteIndex | null,
  query: unknown,
  opts: { page?: number } = {},
): SearchOutcome {
  const q = normalizeQuery(query);
  if (q === "") return { empty: true };
  const language = index?.site.language ?? "en";
  const terms = [...new Set(tokenize(q, language))].slice(
    0,
    SEARCH_LIMITS.terms,
  );
  const docs: Doc[] = [];
  if (index) {
    for (const p of index.pages) {
      docs.push({
        title: p.title,
        path: p.path,
        kind: null,
        description: p.description,
        text: p.text,
        isPage: true,
      });
    }
    for (const r of index.records) {
      docs.push({
        title: r.title,
        path: r.path,
        kind: r.kind,
        description: "",
        text: r.text,
        isPage: false,
      });
    }
  }
  const scored: { doc: Doc; score: number }[] = [];
  if (terms.length > 0) {
    for (const doc of docs) {
      const title = tokenize(doc.title, language);
      const desc = tokenize(doc.description, language);
      const text = tokenize(doc.text, language);
      let score = 0;
      let all = true;
      for (const term of terms) {
        const inTitle = title.some((t) => termMatches(t, term));
        const inDesc = desc.some((t) => termMatches(t, term));
        const inText = text.some((t) => termMatches(t, term));
        if (!inTitle && !inDesc && !inText) {
          all = false;
          break;
        }
        score += (inTitle ? 5 : 0) + (inDesc ? 2 : 0) + (inText ? 1 : 0);
        if ([title, desc, text].some((list) => list.includes(term))) score += 1;
      }
      if (all) scored.push({ doc, score });
    }
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.doc.isPage) - Number(a.doc.isPage) ||
      a.doc.title.localeCompare(b.doc.title),
  );
  const total = scored.length;
  const pages = Math.max(1, Math.ceil(total / SEARCH_PER_PAGE));
  const requested = Number.isFinite(opts.page) ? Math.trunc(opts.page!) : 1;
  const page = Math.min(pages, Math.max(1, requested));
  const slice = scored.slice(
    (page - 1) * SEARCH_PER_PAGE,
    page * SEARCH_PER_PAGE,
  );
  return {
    empty: false,
    query: q,
    total,
    page,
    pages,
    results: slice.map(({ doc }) => ({
      title: doc.title,
      path: doc.path,
      kind: doc.kind,
      snippet: snippetFor(doc, terms, language),
    })),
  };
}
