// The donor XSS corpus (DCR-Website src/lib/rich-text.sanitize.test.ts, "security
// no-regression"), ported to the DOM-free sanitizer. Assertions are semantic: no executable
// markup survives and visible text is preserved (RESEARCH Pitfall 2). The item-18 payload is
// read off disk so it stays byte-identical to the recorded string (.gitattributes -text).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "./sanitize";

const ITEM_18 = readFileSync(
  join(import.meta.dirname, "__fixtures__", "rich-text-xss-item18.txt"),
  "utf8",
);

const EXECUTABLE = [
  "<script",
  "alert(",
  "<img",
  "onerror",
  "javascript:",
  "<a",
  "href",
  "style=",
  "<style",
  "<iframe",
  "<svg",
  "onload",
  "onclick",
  "onmouseover",
];

function assertInert(out: string) {
  const lower = out.toLowerCase();
  for (const bad of EXECUTABLE) expect(lower, bad).not.toContain(bad);
  // Only allowlisted element names may appear at all.
  expect(out).not.toMatch(/<(?!\/?(?:p|br|strong|em|u|ul|ol|li)[\s/>])/i);
}

describe("donor item-18 XSS payload", () => {
  it("is the recorded 114-character string", () => {
    expect(ITEM_18.length).toBe(114);
  });

  it("reduces to inert markup keeping the visible text x and y", () => {
    const out = sanitizeRichText(ITEM_18);
    assertInert(out);
    expect(out).toContain("x");
    expect(out).toContain("y");
    expect(out).toBe("x<p>y</p>");
  });
});

describe("donor structural corpus: text survives, foreign elements do not", () => {
  it.each([
    ["heading", "<h2>Heading</h2>", "Heading"],
    [
      "ordered + unordered list",
      "<ol><li>one</li></ol><ul><li>two</li></ul>",
      "one",
    ],
    ["blockquote", "<blockquote>q</blockquote>", "q"],
    ["table", "<table><tr><td>cell</td></tr></table>", "cell"],
    [
      "font tag with color attribute",
      '<font color="red">colored</font>',
      "colored",
    ],
    ["div with onclick handler", '<div onclick="x()">click</div>', "click"],
    [
      "Word paste (class + span style)",
      '<p class="MsoNormal"><span style="font-weight:700">Bold text</span></p>',
      "Bold text",
    ],
    [
      "Google Docs paste",
      '<b id="docs-internal-guid-x" style="font-weight:normal">Doc text</b>',
      "Doc text",
    ],
  ])("%s", (_label, html, text) => {
    const out = sanitizeRichText(html);
    assertInert(out);
    expect(out).toContain(text);
  });
});

describe("donor style-vector corpus: attributes are never kept", () => {
  it.each([
    [
      "url() in a style value",
      '<span style="text-decoration:url(javascript:alert(1))">x</span>',
    ],
    [
      "CSS comment sequence",
      '<span style="font-weight:700/*comment*/normal">x</span>',
    ],
    ["backslash escape", '<span style="font-weight:\\37 30">x</span>'],
    [
      "entity-encoded value",
      '<span style="font-weight:expression&#40;alert&#40;1&#41;&#41;">x</span>',
    ],
    [
      "embedded quote",
      '<span style="font-weight:700&quot;onmouseover=alert(1)">x</span>',
    ],
  ])("%s", (_label, html) => {
    const out = sanitizeRichText(html);
    assertInert(out);
    expect(out).not.toContain("style");
    expect(out).toContain("x");
  });
});

describe("additional vectors", () => {
  it.each([
    ["svg onload", "<svg onload=alert(1)><p>t</p></svg>"],
    [
      "iframe srcdoc",
      '<iframe srcdoc="<script>alert(1)</script>"></iframe><p>t</p>',
    ],
    [
      "javascript link inside allowed tag",
      '<p><a href="javascript:alert(1)">t</a></p>',
    ],
    [
      "event handler on allowed tag",
      '<strong onmouseover="alert(1)">t</strong>',
    ],
    ["mixed-case script", "<ScRiPt>alert(1)</sCrIpT><p>t</p>"],
    ["unterminated script", "<p>t</p><script>alert(1)"],
    ["html comment hiding script", "<!--<script>alert(1)</script>--><p>t</p>"],
    [
      "noscript wrapper",
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript><p>t</p>',
    ],
  ])("%s", (_label, html) => {
    const out = sanitizeRichText(html);
    assertInert(out);
    expect(out).toContain("t");
  });
});
