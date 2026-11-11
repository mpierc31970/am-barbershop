// @vitest-environment jsdom
// The paste boundary, T-03-29 (03-REVIEW WR-C04, IN-C07). DOMParser needs a DOM, so this
// runs in jsdom. The internal case uses a payload made by ProseMirror's own clipboard
// serializer from a real editor with our extension list, so a change to how TipTap copies
// is caught here.
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { parseTsv, preparePastedRichText, tsvGridForPaste } from "./paste";
import { createRichTextExtensions } from "./rich-text-extensions";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** What a browser hands transformPastedHTML after a copy from one of our editors. */
function copyFromOurEditor(html: string, from?: number, to?: number): string {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: createRichTextExtensions(),
    content: html,
  });
  const { doc } = editor.state;
  const slice = doc.slice(from ?? 0, to ?? doc.content.size);
  const { dom } = editor.view.serializeForClipboard(slice);
  return `<meta charset="utf-8">${dom.innerHTML}`;
}

describe("preparePastedRichText: copies from our own editors keep their marks", () => {
  it("a TipTap clipboard payload (with data-pm-slice) is internal", () => {
    const payload = copyFromOurEditor(
      "<p><strong>Bold</strong> and <em>italic</em> and <u>under</u></p>",
    );
    expect(payload).toContain("data-pm-slice");
    const out = preparePastedRichText(payload);
    expect(out.flattened).toBe(false);
    expect(out.html).toContain("<strong>Bold</strong>");
    expect(out.html).toContain("<em>italic</em>");
  });

  it("a partial selection inside a list is internal too", () => {
    const html =
      "<ul><li><p>one <strong>two</strong></p></li><li><p>three</p></li></ul>";
    const payload = copyFromOurEditor(html, 3, 14);
    const out = preparePastedRichText(payload);
    expect(out.flattened).toBe(false);
  });

  it("the review's literal payload is internal", () => {
    const out = preparePastedRichText(
      '<meta charset="utf-8"><p data-pm-slice="1 1 []"><strong>x</strong></p>',
    );
    expect(out).toMatchObject({ flattened: false, hadTable: false });
    expect(out.html).toContain("<strong>x</strong>");
  });

  it("data-pm-slice in any other shape, or any other attribute, is external", () => {
    for (const html of [
      '<p data-pm-slice="nonsense"><strong>x</strong></p>',
      '<p data-pm-slice="1 1 []" class="x"><strong>x</strong></p>',
      '<p style="color:red"><strong>x</strong></p>',
      '<p><strong data-pm-slice="1 1 []" onclick="alert(1)">x</strong></p>',
    ]) {
      const out = preparePastedRichText(html);
      expect(out.flattened, html).toBe(true);
      expect(out.html).toBe("<p>x</p>");
    }
  });
});

describe("preparePastedRichText: everything else is flattened", () => {
  it("Word: paragraphs kept, formatting and Office markup dropped", () => {
    const word =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8">' +
      "<style>p.MsoNormal{margin:0}</style></head><body>" +
      '<p class="MsoNormal"><b><span style="font-size:14pt">Opening hours</span></b></p>' +
      '<p class="MsoNormal">Mon&nbsp;to Fri<o:p></o:p></p></body></html>';
    const out = preparePastedRichText(word);
    expect(out.flattened).toBe(true);
    expect(out.hadTable).toBe(false);
    expect(out.html).toBe("<p>Opening hours</p><p>Mon to Fri</p>");
  });

  it("Google Docs: the b/id wrapper and spans are dropped, line breaks kept", () => {
    const docs =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
      '<p dir="ltr"><span style="font-weight:700">Title</span></p>' +
      '<p dir="ltr"><span>line one</span><br><span>line two</span></p></b>';
    const out = preparePastedRichText(docs);
    expect(out.flattened).toBe(true);
    expect(out.html).toBe("<p>Title</p><p>line one<br>line two</p>");
  });

  it("tables are flattened and reported so the notice can name them", () => {
    const table =
      "<table><tr><td>Mon</td><td>9-5</td></tr><tr><td>Tue</td><td>9-5</td></tr></table>";
    const out = preparePastedRichText(table);
    expect(out.flattened).toBe(true);
    expect(out.hadTable).toBe(true);
    expect(out.html).toBe("<p>Mon9-5<br>Tue9-5</p>");
  });

  it("script, style and iframe text never becomes visible text; text is escaped", () => {
    const hostile =
      "<p>Hello</p><script>alert('x')</script><style>p{}</style>" +
      '<iframe src="https://evil.example"></iframe><p>&lt;b&gt;not bold&lt;/b&gt; &amp; more</p>' +
      '<img src="x" onerror="alert(1)">';
    const out = preparePastedRichText(hostile);
    expect(out.flattened).toBe(true);
    expect(out.html).toBe(
      "<p>Hello</p><p>&lt;b&gt;not bold&lt;/b&gt; &amp; more</p>",
    );
    expect(out.html).not.toContain("alert");
  });

  it("an empty payload is empty and not flattened", () => {
    expect(preparePastedRichText("")).toEqual({
      html: "",
      flattened: false,
      hadTable: false,
    });
  });
});

describe("parseTsv / tsvGridForPaste (07-21)", () => {
  it("splits tabs and CRLF rows, dropping one trailing newline", () => {
    expect(parseTsv("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseTsv("a\nb")).toEqual([["a"], ["b"]]);
    expect(parseTsv("a\rb\r")).toEqual([["a"], ["b"]]);
  });

  it("unquotes quoted cells with tabs, doubled quotes and newlines", () => {
    expect(parseTsv('"x\ty"\t"he said ""hi"""')).toEqual([
      ["x\ty", 'he said "hi"'],
    ]);
    expect(parseTsv('"line 1\nline 2"\tb\n')).toEqual([
      ["line 1\nline 2", "b"],
    ]);
  });

  it("keeps ragged rows and empty cells", () => {
    expect(parseTsv("a\tb\tc\nd\n\te")).toEqual([
      ["a", "b", "c"],
      ["d"],
      ["", "e"],
    ]);
  });

  it("empty text is no rows", () => {
    expect(parseTsv("")).toEqual([]);
  });

  it("a single cell pastes normally (null)", () => {
    expect(tsvGridForPaste("just text")).toBeNull();
    expect(tsvGridForPaste("just text\n")).toBeNull();
    expect(tsvGridForPaste("")).toBeNull();
  });

  it("a multi-cell paste is a grid", () => {
    expect(tsvGridForPaste("a\tb")).toEqual([["a", "b"]]);
    expect(tsvGridForPaste("a\nb")).toEqual([["a"], ["b"]]);
  });

  it("refuses text over MAX_IMPORT_BYTES", () => {
    expect(tsvGridForPaste("a\t".repeat(800_000))).toBeNull();
  });

  it("stops one past the table limits", () => {
    const tall = "x\ty\n".repeat(500);
    expect(tsvGridForPaste(tall)).toHaveLength(201);
    const wide = Array.from({ length: 30 }, (_, i) => `c${i}`).join("\t");
    expect(tsvGridForPaste(wide)![0]).toHaveLength(11);
  });
});
