// DOM-free plain text from rich-text html (donor rich-text.ts htmlToPlainText port).
import { describe, expect, it } from "vitest";
import { htmlToPlainText, isRichTextEmpty } from "./plain-text";

describe("htmlToPlainText", () => {
  it("separates block and line breaks with whitespace", () => {
    const out = htmlToPlainText("<p>a<br>b</p><ul><li>c</li></ul>");
    expect(out).toMatch(/a\s+b\s+c/);
  });

  it("keeps inline runs together", () => {
    expect(htmlToPlainText("<p>Hello <strong>big</strong> world</p>")).toBe(
      "Hello big world",
    );
  });

  it("decodes the common entities", () => {
    expect(
      htmlToPlainText("<p>&amp; &lt;b&gt; &quot;q&quot; it&#39;s&nbsp;x</p>"),
    ).toBe('& <b> "q" it\'s x');
  });

  it("decodes numeric entities", () => {
    expect(htmlToPlainText("&#169; &#x2014;")).toBe("© —");
  });

  it("drops script and style contents", () => {
    expect(
      htmlToPlainText("<style>p{}</style><p>ok</p><script>alert(1)</script>"),
    ).toBe("ok");
  });

  it("does not decode twice", () => {
    expect(htmlToPlainText("&amp;lt;")).toBe("&lt;");
  });

  it("handles empty and non-string input", () => {
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText(undefined as unknown as string)).toBe("");
  });
});

describe("isRichTextEmpty", () => {
  it("is true for an empty paragraph", () => {
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty("<p><br></p>")).toBe(true);
    expect(isRichTextEmpty("<p>&nbsp; </p>")).toBe(true);
    expect(isRichTextEmpty("")).toBe(true);
  });

  it("is false with text", () => {
    expect(isRichTextEmpty("<p>x</p>")).toBe(false);
  });
});
