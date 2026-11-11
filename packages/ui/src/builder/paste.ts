// Paste boundary for RichTextEditor (03-08; CONT-09; T-03-29) and spreadsheet paste for the
// table editor (07-21; CONT-26, D120; T-07-21-03).
//
// Ported from donor DCR-Website src/lib/rich-text.ts preparePastedRichText and helpers.
// preparePastedRichText is BROWSER-ONLY: it uses DOMParser and runs from TipTap's
// transformPastedHTML, which only fires in the browser. Never call it from server code.
// parseTsv and tsvGridForPaste (bottom of the file) are pure and run anywhere.
//
// The rule (donor product-owner correction): a copy between two of our own editors keeps
// its marks; a paste from anywhere else (Word, Google Docs, Canva, a web page) is
// flattened to plain text, paragraph breaks kept. The donor passed the internal branch
// through its DOMPurify sanitizer; @cds/ui carries no sanitizer (the Node-only cleaner
// lives in its own @cds/core subpath and stays out of client bundles). That is safe
// because the internal branch is, by construction, only the allowlisted tags with no
// attributes (except ProseMirror's own well-formed data-pm-slice marker), TipTap's
// schema parses only the nodes and marks it knows, and the server
// sanitizes the stored HTML again on save, publish and render.
import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS } from "@cds/core/content";
import { MAX_IMPORT_BYTES } from "@cds/core/csv";

/**
 * Tags our own editor emits. A payload made only of these, with no attributes but
 * data-pm-slice, is ours.
 */
const EDITOR_TAGS: readonly string[] = [
  "strong",
  "em",
  "u",
  "p",
  "br",
  "ul",
  "ol",
  "li",
];

// Wrapper tags DOMParser and browsers add to every clipboard payload.
const STRUCTURAL_IGNORE_TAGS = new Set([
  "html",
  "head",
  "body",
  "meta",
  "link",
]);

// Elements whose text is never pasted (script source must not become visible text).
const CONTENT_BEARING_ELEMENTS: readonly string[] = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "title",
];

const PARAGRAPH_BREAK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
]);
const LINE_BREAK_TAGS = new Set(["li", "tr"]);
const TABLE_SELECTOR = "table, tr, td, th";

// ProseMirror's serializeForClipboard always marks the first copied element with
// data-pm-slice="<openStart> <openEnd>[ -<wrappers>] <context JSON>" (prosemirror-view).
// It is the one attribute our own copies carry, so it is the one attribute allowed, and
// only in that exact shape (WR-C04). ProseMirror reads it back against our schema.
const PM_SLICE_ATTR = "data-pm-slice";
const PM_SLICE_VALUE = /^\d+ \d+(?: -\d+)? \[.*\]$/;

function isEditorAttribute(attr: Attr): boolean {
  return attr.name === PM_SLICE_ATTR && PM_SLICE_VALUE.test(attr.value);
}

function isInternalPasteShape(doc: Document): boolean {
  const elements = doc.documentElement.querySelectorAll("*");
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i]!;
    const tag = el.tagName.toLowerCase();
    if (STRUCTURAL_IGNORE_TAGS.has(tag)) continue;
    if (!EDITOR_TAGS.includes(tag)) return false;
    if (!Array.from(el.attributes).every(isEditorAttribute)) return false;
  }
  return true;
}

/** Plain text with "\n\n" at paragraph boundaries and "\n" at line boundaries. */
function extractPastedPlainText(root: Element): string {
  let text = "";
  let pending: "" | "\n" | "\n\n" = "";

  const flush = () => {
    if (pending && text.length > 0) text += pending;
    pending = "";
  };
  const request = (b: "\n" | "\n\n") => {
    pending = b === "\n\n" || pending === "\n\n" ? "\n\n" : "\n";
  };

  const visit = (node: ChildNode): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent ?? "";
      if (!content) return;
      flush();
      text += content;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (CONTENT_BEARING_ELEMENTS.includes(tag)) return;
    if (tag === "br") {
      request("\n");
      return;
    }
    const boundary = PARAGRAPH_BREAK_TAGS.has(tag)
      ? "\n\n"
      : LINE_BREAK_TAGS.has(tag)
        ? "\n"
        : null;
    if (boundary) request(boundary);
    el.childNodes.forEach(visit);
    if (boundary) request(boundary);
  };

  root.childNodes.forEach(visit);
  return text.trim();
}

/** "\n\n" runs become sibling <p>s, a single "\n" becomes <br>. Text is escaped. */
function pastedTextToRichHtml(text: string): string {
  if (!text || !text.trim()) return "";
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const escaped = p
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<p>${escaped.replace(/\r\n|\r|\n/g, "<br>")}</p>`;
    })
    .join("");
}

export interface PreparedPaste {
  html: string;
  /** True when an external paste was flattened (the editor shows a notice). */
  flattened: boolean;
  /** True when the payload held a table (the notice names tables). */
  hadTable: boolean;
}

/**
 * The paste boundary's single entry point. Fail-closed: with no DOMParser (reached from
 * somewhere other than a browser paste) it returns empty rather than trust the input.
 */
export function preparePastedRichText(html: string): PreparedPaste {
  if (!html) return { html: "", flattened: false, hadTable: false };
  if (typeof DOMParser === "undefined") {
    return { html: "", flattened: true, hadTable: false };
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const hadTable = doc.documentElement.querySelector(TABLE_SELECTOR) !== null;
  if (isInternalPasteShape(doc)) {
    return { html, flattened: false, hadTable };
  }
  return {
    html: pastedTextToRichHtml(extractPastedPlainText(doc.body)),
    flattened: true,
    hadTable,
  };
}

// ---------------------------------------------------------------------------------------
// Spreadsheet paste (07-21; CONT-26, D120; T-07-21-03). Pure: runs anywhere.
//
// Excel and Google Sheets put a copied range on the clipboard as TSV: tab between cells,
// CR/LF/CRLF between rows, a field holding a tab, newline or quote wrapped in quotes with
// inner quotes doubled, and one trailing newline. The table editor feeds the result to
// table-logic pasteGrid.

export interface TsvLimits {
  /** Stop after this many rows. */
  rows: number;
  /** Keep at most this many cells per row. */
  cols: number;
}

/** Parse clipboard TSV into rows of cell strings (ragged rows kept as-is). */
export function parseTsv(text: string, limits?: TsvLimits): string[][] {
  if (typeof text !== "string" || text === "") return [];
  const maxRows = limits?.rows ?? Number.POSITIVE_INFINITY;
  const maxCols = limits?.cols ?? Number.POSITIVE_INFINITY;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;

  const endField = () => {
    if (row.length < maxCols) row.push(field);
    field = "";
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  let i = 0;
  while (i < text.length && rows.length < maxRows) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      i += 1;
      continue;
    }
    if (ch === "\t") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    fieldStart = false;
    i += 1;
  }
  // No trailing newline: the last row is still open.
  if (
    rows.length < maxRows &&
    (field !== "" || row.length > 0 || !fieldStart)
  ) {
    endRow();
  }
  return rows;
}

function utf8Bytes(text: string): number {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

/**
 * The grid to paste into a table, or null to let the browser paste normally: empty text,
 * a single cell, or more than MAX_IMPORT_BYTES. Parsing stops one past the table limits
 * (TABLE_MAX_ROWS + 1 rows, TABLE_MAX_COLUMNS + 1 cells) so the caller can report the limit
 * without reading a huge paste.
 */
export function tsvGridForPaste(text: string): string[][] | null {
  if (typeof text !== "string" || text === "") return null;
  if (text.length > MAX_IMPORT_BYTES || utf8Bytes(text) > MAX_IMPORT_BYTES) {
    return null;
  }
  const grid = parseTsv(text, {
    rows: TABLE_MAX_ROWS + 1,
    cols: TABLE_MAX_COLUMNS + 1,
  });
  if (grid.length === 0) return null;
  if (grid.length === 1 && grid[0]!.length <= 1) return null;
  return grid;
}
