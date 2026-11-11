// html helpers (08-12; T-08-12-01, T-08-12-02).
import { describe, expect, it } from "vitest";
import { excerpt, paragraphs, telHref } from "./html";

describe("paragraphs", () => {
  it("splits on blank lines and escapes each paragraph", () => {
    expect(paragraphs("a\n\nb <x>")).toBe("<p>a</p><p>b &lt;x&gt;</p>");
  });

  it("escapes a script tag and quotes", () => {
    const out = paragraphs(`<script>alert("x")</script>`);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("drops empty paragraphs and trims; empty text gives empty string", () => {
    expect(paragraphs("  one  \n\n\n\n  two ")).toBe("<p>one</p><p>two</p>");
    expect(paragraphs("")).toBe("");
    expect(paragraphs("   \n\n  ")).toBe("");
  });

  it("keeps a single line break inside a paragraph as <br>", () => {
    expect(paragraphs("line one\nline two")).toBe(
      "<p>line one<br>line two</p>",
    );
  });

  it("a non-string never throws", () => {
    expect(paragraphs(42 as unknown as string)).toBe("");
  });
});

describe("excerpt (D-UI-P8-20)", () => {
  it("returns the first paragraph whole when it fits", () => {
    expect(excerpt("Short one. Two.\n\nSecond para.", 320)).toBe(
      "Short one. Two.",
    );
  });

  it("cuts at the last sentence end at or before max", () => {
    const text = "First sentence here. Second one is longer! Third? Fourth.";
    expect(excerpt(text, 45)).toBe(
      "First sentence here. Second one is longer!",
    );
    expect(excerpt(text, 20)).toBe("First sentence here.");
  });

  it("with no sentence end in range, cuts at the last word boundary, no ellipsis", () => {
    const text = "one two three four five six seven eight";
    const out = excerpt(text, 15);
    expect(out).toBe("one two three");
    expect(out).not.toContain("…");
    expect(out.endsWith(".")).toBe(false);
  });

  it("a single long word is hard-cut at max (bounded)", () => {
    expect(excerpt("x".repeat(1000), 320)).toHaveLength(320);
  });

  it("is never longer than max and never throws on bad input", () => {
    expect(excerpt("a ".repeat(500), 320).length).toBeLessThanOrEqual(320);
    expect(excerpt(undefined as unknown as string, 320)).toBe("");
    expect(excerpt("", 320)).toBe("");
  });

  it("returns plain text (escaping is the caller's job via paragraphs)", () => {
    expect(excerpt("Tom & Jerry.", 320)).toBe("Tom & Jerry.");
  });
});

describe("telHref (the shared @cds/core/content helper)", () => {
  it("sends an extension as ;ext=, never as dialed digits (CR-B02)", () => {
    expect(telHref("(512) 555-0100 ext. 42")).toBe("tel:5125550100;ext=42");
    expect(telHref("(512) 555-0100 ext 42")).toBe("tel:5125550100;ext=42");
    expect(telHref("512-555-0100 x7")).toBe("tel:5125550100;ext=7");
    expect(telHref("+1 512 555 0100x123456")).toBe(
      "tel:+15125550100;ext=123456",
    );
    expect(telHref("512-555-0100 EXT. 9 ")).toBe("tel:5125550100;ext=9");
  });

  it("an extension with no number gives no href", () => {
    expect(telHref("ext. 42")).toBe("");
  });

  it("keeps digits and a leading +", () => {
    expect(telHref("(512) 555-0100")).toBe("tel:5125550100");
    expect(telHref("+1 (512) 555-0100")).toBe("tel:+15125550100");
  });

  it("drops a + that is not leading and any markup", () => {
    expect(telHref("512+555<b>0100")).toBe("tel:5125550100");
  });

  it("returns empty when there are no digits or the value is not a string", () => {
    expect(telHref("call us")).toBe("");
    expect(telHref("")).toBe("");
    expect(telHref(null as unknown as string)).toBe("");
  });
});
