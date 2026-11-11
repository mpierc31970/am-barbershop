// THEME-03: DESIGN.md front matter parsing and {path} reference resolution (CONTEXT A1-Q4,
// RESEARCH Pitfall 7, T-04-19, T-04-20).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { resolveRefs, splitFrontMatter } from "./frontmatter";

const LF = [
  "---",
  "name: Tidewater",
  "colors:",
  '  teal: "#1f6f6b"',
  '  primary: "{colors.teal}"',
  "---",
  "",
  "## Overview",
  "",
  "Sea light.",
  "",
].join("\n");

describe("splitFrontMatter", () => {
  it("parses LF front matter and returns the body", () => {
    const { frontMatter, body } = splitFrontMatter(LF);
    expect(frontMatter.name).toBe("Tidewater");
    expect(frontMatter.colors).toEqual({
      teal: "#1f6f6b",
      primary: "{colors.teal}",
    });
    expect(body).toBe("## Overview\n\nSea light.\n");
  });

  it("treats CRLF input exactly like LF", () => {
    const crlf = LF.replace(/\n/g, "\r\n");
    expect(splitFrontMatter(crlf)).toEqual(splitFrontMatter(LF));
  });

  it("rejects a file with no front matter", () => {
    expect(() => splitFrontMatter("## Overview\n\nNo fence.\n")).toThrow(
      InvalidInput,
    );
  });

  it("rejects front matter that is not a mapping", () => {
    expect(() => splitFrontMatter("---\n- a\n- b\n---\nbody\n")).toThrow(
      InvalidInput,
    );
  });

  it("surfaces invalid YAML as InvalidInput", () => {
    expect(() => splitFrontMatter("---\nname: [unclosed\n---\n")).toThrow(
      InvalidInput,
    );
  });

  it("rejects an alias bomb (maxAliasCount 100)", () => {
    const lines = ["---", 'a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
    const names = "abcdefghij";
    for (let i = 1; i < names.length; i++) {
      const prev = names[i - 1];
      const refs = Array.from({ length: 10 }, () => `*${prev}`).join(",");
      lines.push(`${names[i]}: &${names[i]} [${refs}]`);
    }
    lines.push("---", "");
    expect(() => splitFrontMatter(lines.join("\n"))).toThrow(InvalidInput);
  });
});

describe("resolveRefs", () => {
  it("resolves a colour reference", () => {
    const out = resolveRefs({
      colors: { teal: "#1f6f6b", primary: "{colors.teal}" },
    });
    expect(out).toEqual({ colors: { teal: "#1f6f6b", primary: "#1f6f6b" } });
  });

  it("resolves nested typography and chained references", () => {
    const out = resolveRefs({
      colors: {
        teal: "#1f6f6b",
        brand: "{colors.teal}",
        link: "{colors.brand}",
      },
      typography: { body: { fontFamily: "Figtree", fontSize: "18px" } },
      components: {
        button: { typography: "{typography.body}", bg: "{colors.link}" },
      },
    });
    expect(out.components).toEqual({
      button: {
        typography: { fontFamily: "Figtree", fontSize: "18px" },
        bg: "#1f6f6b",
      },
    });
  });

  it("names the key and the missing reference", () => {
    expect(() =>
      resolveRefs({ colors: { teal: "#1f6f6b", primary: "{colors.nope}" } }),
    ).toThrow("colors.primary refers to {colors.nope}, which doesn't exist.");
  });

  it("throws on a reference cycle instead of looping", () => {
    expect(() =>
      resolveRefs({ colors: { a: "{colors.b}", b: "{colors.a}" } }),
    ).toThrow(InvalidInput);
  });

  it("leaves strings that merely contain braces alone and never mutates input", () => {
    const input = { colors: { teal: "#1f6f6b" }, note: "use {braces} freely" };
    const out = resolveRefs(input);
    expect(out.note).toBe("use {braces} freely");
    expect(out).not.toBe(input);
    expect(input.colors).toEqual({ teal: "#1f6f6b" });
  });

  it("stops a {ref} 'billion laughs' with InvalidInput, fast (WR-03)", () => {
    // l(n) holds ten references to l(n-1): ~10^9 nodes if expanded naively.
    const md: Record<string, unknown> = { l0: ["x", "x", "x", "x", "x"] };
    for (let i = 1; i <= 9; i++) {
      md[`l${i}`] = Array.from({ length: 10 }, () => `{l${i - 1}}`);
    }
    const started = Date.now();
    expect(() => resolveRefs(md)).toThrow(
      "DESIGN.md front matter expands too large.",
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("the same bomb through YAML text is refused by splitFrontMatter + resolveRefs", () => {
    const lines = ["---", "l0: [x, x, x, x, x]"];
    for (let i = 1; i <= 9; i++) {
      lines.push(
        `l${i}: [${Array(10)
          .fill(`"{l${i - 1}}"`)
          .join(", ")}]`,
      );
    }
    lines.push("---", "");
    const { frontMatter } = splitFrontMatter(lines.join("\n"));
    expect(() => resolveRefs(frontMatter)).toThrow(InvalidInput);
  });

  it("deep nesting (no references) is 'nested too deeply', not a RangeError", () => {
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 40; i++) deep = { n: deep };
    expect(() => resolveRefs({ deep })).toThrow(
      "DESIGN.md front matter is nested too deeply.",
    );
    let arr: unknown = "x";
    for (let i = 0; i < 40; i++) arr = [arr];
    expect(() => resolveRefs({ arr })).toThrow(InvalidInput);
  });

  it("drops prototype-polluting keys", () => {
    const input = JSON.parse('{"__proto__": {"x": 1}, "name": "A"}') as Record<
      string,
      unknown
    >;
    const out = resolveRefs(input);
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(false);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
