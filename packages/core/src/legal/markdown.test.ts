// RESEARCH Pitfall 8, T-09-01-01: escape-first restricted legal markdown.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  clauseMarkers,
  lintLegalMarkdown,
  renderLegalMarkdown,
  stripClauseMarkers,
} from "./markdown";

describe("renderLegalMarkdown", () => {
  it("renders the subset with no newlines between blocks", () => {
    expect(
      renderLegalMarkdown("## Fees\n\nYou pay **monthly**.\n\n- one\n- two"),
    ).toBe(
      "<h2>Fees</h2><p>You pay <strong>monthly</strong>.</p><ul><li>one</li><li>two</li></ul>",
    );
  });

  it("renders h3, ordered lists and joins paragraph lines with a space", () => {
    expect(
      renderLegalMarkdown("### Term\nline one\nline two\n\n1. a\n2. b"),
    ).toBe(
      "<h3>Term</h3><p>line one line two</p><ol><li>a</li><li>b</li></ol>",
    );
  });

  it("renders one nested list level inside the parent item", () => {
    expect(renderLegalMarkdown("- a\n  - b\n  - c\n- d")).toBe(
      "<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>",
    );
  });

  it("escapes raw HTML", () => {
    const out = renderLegalMarkdown("<script>x</script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script");
  });

  it("links only https and mailto", () => {
    expect(renderLegalMarkdown("[mail us](mailto:a@b.test)")).toBe(
      '<p><a href="mailto:a@b.test">mail us</a></p>',
    );
    expect(renderLegalMarkdown("[site](https://x.test)")).toBe(
      '<p><a href="https://x.test">site</a></p>',
    );
    const js = renderLegalMarkdown("[x](javascript:alert(1))");
    expect(js).not.toContain("<a");
    expect(js).toContain("javascript:alert(1)");
    expect(renderLegalMarkdown("[x](http://x.test)")).not.toContain("<a");
  });

  it("strips clause markers", () => {
    const md = "<!-- clause:dmca-agent -->\n## Agent\n\nText.";
    const out = renderLegalMarkdown(md);
    expect(out).not.toContain("clause");
    expect(out).toBe("<h2>Agent</h2><p>Text.</p>");
    expect(clauseMarkers(md)).toEqual(["dmca-agent"]);
    expect(stripClauseMarkers(md)).toBe("## Agent\n\nText.");
  });

  it("inserts variables after escaping", () => {
    const out = renderLegalMarkdown("We are {{legal_name}}.", {
      vars: { legal_name: "<b>Ana</b>" },
    });
    expect(out).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(out).not.toContain("<b>");
  });

  it("a variable cannot become markdown", () => {
    const out = renderLegalMarkdown("Hi {{n}}", {
      vars: { n: "**x** [a](https://e.test)" },
    });
    expect(out).not.toContain("<strong>");
    expect(out).not.toContain("<a");
  });

  it("an unknown variable throws InvalidInput", () => {
    expect(() => renderLegalMarkdown("{{nope}}")).toThrow(InvalidInput);
    expect(() =>
      renderLegalMarkdown("{{nope}}", { vars: { other: "x" } }),
    ).toThrow(InvalidInput);
  });

  it("is deterministic", () => {
    const md = "## A\n\n- **b** [c](https://d.test)\n\ntext";
    expect(renderLegalMarkdown(md)).toBe(renderLegalMarkdown(md));
  });
});

describe("lintLegalMarkdown", () => {
  it("a clean document has no problems", () => {
    expect(
      lintLegalMarkdown(
        "<!-- clause:a-b -->\n## H\n\n### S\n\nText **bold** [l](https://x.test) {{legal_name}}.\n\n- a\n  - b\n1. c",
      ),
    ).toEqual([]);
  });

  it.each([
    ["| a |", /table/i],
    ["<div>x</div>", /html/i],
    ["an _x_ word", /emphasis/i],
    ["an *x* word", /emphasis/i],
    ["![alt](https://x.test/a.png)", /image/i],
    ["# Title", /h1|heading/i],
    ["#### Deep", /heading/i],
    ["- a\n  - b\n    - c", /nest/i],
    ["[x](javascript:alert(1))", /link/i],
  ])("reports %j", (md, re) => {
    const problems = lintLegalMarkdown(md);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toMatch(re);
    expect(problems[0]).toMatch(/line \d+/);
  });
});
