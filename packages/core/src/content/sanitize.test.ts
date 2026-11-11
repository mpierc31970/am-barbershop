// CONT-09: the DOM-free rich-text allowlist. Runs in the node environment on purpose: the
// sanitizer is sanitize-html (htmlparser2), not DOMPurify, so no jsdom is involved and the
// assertions are semantic (tag present / absent), never jsdom-serialization byte matches.
import { describe, expect, it } from "vitest";
import {
  RICH_TEXT_ALLOWED_TAGS,
  sanitizeLegalHtml,
  sanitizeRichText,
} from "./sanitize";

const tagsIn = (html: string) =>
  new Set(
    [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1]?.toLowerCase()),
  );

describe("RICH_TEXT_ALLOWED_TAGS", () => {
  it("is the eight-tag allowlist (donor seven plus ol)", () => {
    expect([...RICH_TEXT_ALLOWED_TAGS]).toEqual([
      "p",
      "br",
      "strong",
      "em",
      "u",
      "ul",
      "ol",
      "li",
    ]);
  });
});

describe("sanitizeRichText", () => {
  it("keeps every allowlisted tag", () => {
    const out = sanitizeRichText(
      "<p><strong>a</strong><em>b</em><u>c</u><br></p><ul><li>d</li></ul><ol><li>e</li></ol>",
    );
    const tags = tagsIn(out);
    for (const t of RICH_TEXT_ALLOWED_TAGS) expect(tags.has(t), t).toBe(true);
    expect(out).toMatch(/<br\s*\/?>/);
    for (const text of ["a", "b", "c", "d", "e"]) expect(out).toContain(text);
  });

  it("drops a disallowed wrapper but keeps its text", () => {
    const out = sanitizeRichText("<div><span>hi</span></div>");
    expect(out).toContain("hi");
    expect(out).not.toContain("<div");
    expect(out).not.toContain("<span");
  });

  it("drops every attribute", () => {
    expect(sanitizeRichText('<p class="x" id="y" onclick="z">t</p>')).toBe(
      "<p>t</p>",
    );
  });

  it("drops attributes off list elements, keeping structure", () => {
    expect(
      sanitizeRichText(
        '<ul class="x" style="color:red"><li id="y" onclick="z()">a</li></ul>',
      ),
    ).toBe("<ul><li>a</li></ul>");
  });

  it("drops links (not in the allowlist) but keeps the link text", () => {
    const out = sanitizeRichText('<a href="https://x.test">link</a>');
    expect(out).toContain("link");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("href");
  });

  it("removes script and style elements with their content", () => {
    expect(
      sanitizeRichText("<script>alert(1)</script><style>p{}</style>ok"),
    ).toBe("ok");
  });

  it("removes img including its onerror handler", () => {
    const out = sanitizeRichText("<img src=x onerror=alert(1)>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror");
  });

  it("drops headings, keeping their text", () => {
    const out = sanitizeRichText("<h1>big</h1>");
    expect(out).not.toContain("<h1");
    expect(out).toContain("big");
  });

  it("drops id and name (DOM-clobbering surface)", () => {
    const out = sanitizeRichText('<p id="x" name="y">a</p>');
    expect(out).not.toContain("id=");
    expect(out).not.toContain("name=");
  });

  it("returns empty string for empty and non-string input", () => {
    expect(sanitizeRichText("")).toBe("");
    expect(sanitizeRichText(null)).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
    expect(sanitizeRichText(42)).toBe("");
    expect(sanitizeRichText({})).toBe("");
  });

  it("is idempotent: clean output passes through unchanged", () => {
    const clean = sanitizeRichText("<p>One<br>Two</p><p>Three</p>");
    expect(sanitizeRichText(clean)).toBe(clean);
  });

  it("escapes stray angle brackets in text instead of emitting markup", () => {
    const out = sanitizeRichText("<p>a < b &amp; c > d</p>");
    expect(tagsIn(out)).toEqual(new Set(["p"]));
    expect(out).toContain("&lt;");
  });
});

describe("sanitizeLegalHtml (P9, RESEARCH Pitfall 8)", () => {
  it("keeps the legal tags and https/mailto links", () => {
    const out = sanitizeLegalHtml(
      '<h2>a</h2><h3>b</h3><p><strong>c</strong></p><ul><li>d</li></ul><ol><li>e</li></ol><a href="https://x.test">f</a><a href="mailto:a@b.test">g</a>',
    );
    for (const t of ["h2", "h3", "p", "strong", "ul", "ol", "li", "a"])
      expect(tagsIn(out).has(t), t).toBe(true);
    expect(out).toContain('href="https://x.test"');
    expect(out).toContain('href="mailto:a@b.test"');
  });

  it("strips everything else, including on* attributes and bad schemes", () => {
    const out = sanitizeLegalHtml(
      '<h1>x</h1><em>y</em><img src="https://x.test/a.png"><p onclick="z()">t</p><a href="javascript:alert(1)">j</a><script>s()</script>',
    );
    expect(tagsIn(out)).toEqual(new Set(["p", "a"]));
    expect(out).not.toMatch(/onclick|javascript|script|<img/);
  });

  it("leaves the rich-text allowlist untouched", () => {
    expect(sanitizeRichText("<h2>a</h2>")).not.toContain("<h2>");
  });
});
