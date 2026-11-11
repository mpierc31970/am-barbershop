// Restricted legal markdown (AGR-01, RESEARCH Pitfall 8, T-09-01-01). Pure, no dependency.
//
// Supported: `## ` / `### ` headings, paragraphs (blank-line separated; lines joined with a
// space), `- ` and `1. ` lists with one nested level (indented), `**bold**`, and
// `[text](https://… | mailto:…)` links. Everything else stays literal text.
//
// Escape-first: each line is HTML-escaped before the subset is applied, so authored or
// tenant text can never become markup. `{{name}}` template variables are substituted last,
// escaped, so a variable can never become markdown or HTML. Full-line
// `<!-- clause:<id> -->` markers are removed before rendering.
//
// Output has no newlines between block elements, so the bytes are deterministic for a given
// input. lintLegalMarkdown (codegen) rejects anything outside the subset.
import { escapeHtml } from "../email/escape";
import { InvalidInput } from "../errors";

const CLAUSE_RE = /^\s*<!-- clause:([a-z0-9][a-z0-9-]*) -->\s*$/;
const HEADING_RE = /^(#{2,3}) +(.+)$/;
const LIST_RE = /^( *)(- |\d+\. )(.*)$/;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const SAFE_URL_RE = /^(https:\/\/|mailto:)/;

export type LegalMarkdownOptions = {
  vars?: Readonly<Record<string, string>>;
};

/** Clause ids in document order (`<!-- clause:dmca-agent -->` -> "dmca-agent"). */
export function clauseMarkers(md: string): string[] {
  const ids: string[] = [];
  for (const line of normalise(md).split("\n")) {
    const m = CLAUSE_RE.exec(line);
    if (m) ids.push(m[1]!);
  }
  return ids;
}

/** The document without its clause-marker lines. */
export function stripClauseMarkers(md: string): string {
  return normalise(md)
    .split("\n")
    .filter((l) => !CLAUSE_RE.test(l))
    .join("\n");
}

function normalise(md: string): string {
  return String(md).replace(/\r\n?/g, "\n");
}

function inline(text: string, vars: LegalMarkdownOptions["vars"]): string {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(LINK_RE, (m, label: string, url: string) =>
    SAFE_URL_RE.test(url) ? `<a href="${url}">${label}</a>` : m,
  );
  s = s.replace(VAR_RE, (_m, name: string) => {
    if (!vars || !Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new InvalidInput(`unknown template variable {{${name}}}`);
    }
    return escapeHtml(String(vars[name]));
  });
  return s;
}

type ListKind = "ul" | "ol";
type Item = { html: string; sub: { kind: ListKind; items: string[] } | null };
type List = { kind: ListKind; items: Item[] };

/** Render the restricted subset to HTML (escape-first, deterministic). */
export function renderLegalMarkdown(
  md: string,
  opts: LegalMarkdownOptions = {},
): string {
  const vars = opts.vars;
  const out: string[] = [];
  let para: string[] = [];
  const st: { list: List | null } = { list: null };

  const flushPara = () => {
    if (para.length > 0) out.push(`<p>${inline(para.join(" "), vars)}</p>`);
    para = [];
  };
  const flushList = () => {
    const list = st.list;
    if (!list) return;
    const items = list.items
      .map((it) => {
        const sub = it.sub
          ? `<${it.sub.kind}>${it.sub.items.map((x) => `<li>${x}</li>`).join("")}</${it.sub.kind}>`
          : "";
        return `<li>${it.html}${sub}</li>`;
      })
      .join("");
    out.push(`<${list.kind}>${items}</${list.kind}>`);
    st.list = null;
  };

  for (const raw of stripClauseMarkers(md).split("\n")) {
    if (raw.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const h = HEADING_RE.exec(raw);
    if (h) {
      flushPara();
      flushList();
      const tag = h[1]!.length === 2 ? "h2" : "h3";
      out.push(`<${tag}>${inline(h[2]!.trim(), vars)}</${tag}>`);
      continue;
    }
    const li = LIST_RE.exec(raw);
    if (li) {
      flushPara();
      const kind: ListKind = li[2] === "- " ? "ul" : "ol";
      const html = inline(li[3]!.trim(), vars);
      const current = st.list;
      const last = current
        ? current.items[current.items.length - 1]
        : undefined;
      if (li[1]!.length > 0 && last) {
        if (!last.sub) last.sub = { kind, items: [] };
        last.sub.items.push(html);
        continue;
      }
      if (current && current.kind !== kind) flushList();
      if (!st.list) st.list = { kind, items: [] };
      st.list.items.push({ html, sub: null });
      continue;
    }
    flushList();
    para.push(raw.trim());
  }
  flushPara();
  flushList();
  return out.join("");
}

/** Problems with line numbers for anything outside the subset; [] when clean. */
export function lintLegalMarkdown(md: string): string[] {
  const problems: string[] = [];
  const lines = normalise(md).split("\n");
  lines.forEach((line, i) => {
    const at = (msg: string) => problems.push(`line ${i + 1}: ${msg}`);
    if (line.trim() === "" || CLAUSE_RE.test(line)) return;

    if (/^\s*\|/.test(line) || /\|.*\|/.test(line))
      at("tables are not supported");
    if (/^#(\s|$)/.test(line)) at("H1 heading is not allowed (use ## or ###)");
    if (/^#{4,}/.test(line)) at("heading deeper than ### is not supported");
    if (/!\[/.test(line)) at("images are not supported");
    if (/<[A-Za-z!/?]/.test(line))
      at("raw HTML is not allowed (only clause markers)");

    for (const m of line.matchAll(/\[([^\]]*)\]\(([^)]*)\)?/g)) {
      if (!SAFE_URL_RE.test(m[2] ?? "")) {
        at(`link must be https:// or mailto: (${m[2] ?? ""})`);
      }
    }

    const li = LIST_RE.exec(line);
    if (li && li[1]!.length >= 4) at("lists nested deeper than one level");

    let s = line.replace(/^\s*(- |\d+\. )/, "");
    s = s.replace(/\{\{[^}]*\}\}/g, "");
    s = s.replace(/\]\([^)]*\)/g, "]");
    s = s.replace(/\*\*(.+?)\*\*/g, "$1");
    if (/\*/.test(s)) at("*emphasis* is not supported (use **bold**)");
    if (/(^|[^\w])_[^_]+_($|[^\w])/.test(s)) {
      at("_emphasis_ is not supported (use **bold**)");
    }
  });
  return problems;
}
