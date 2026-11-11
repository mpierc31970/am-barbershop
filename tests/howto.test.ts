import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// PLAT-07 / D110: every how-to has recordable Activate + Use steps.

const repoRoot = path.resolve(import.meta.dirname, "..");
const howtoDir = path.join(repoRoot, "docs", "how-to");

const REQUIRED_FRONTMATTER = ["feature", "phase", "route"] as const;
const REQUIRED_SECTIONS = ["Activate", "Use"] as const;
const REQUIRED_HEADER = ["#", "Screen / route", "Action", "Expected result"];

function parseFrontmatter(md: string): Record<string, string> | null {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  const out: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function splitSections(md: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = md.replace(/\r\n/g, "\n").split(/^## /m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    sections.set(title, nl === -1 ? "" : part.slice(nl + 1));
  }
  return sections;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** First markdown table in a section: header cells + data row count. */
function firstTable(body: string): { header: string[]; rows: number } | null {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith("|"));
  if (start === -1) return null;
  const tableLines: string[] = [];
  for (const l of lines.slice(start)) {
    if (!l.trim().startsWith("|")) break;
    tableLines.push(l);
  }
  const [head, sep, ...data] = tableLines;
  if (!sep || !/^[\s|:-]+$/.test(sep)) return { header: cells(head), rows: 0 };
  return { header: cells(head), rows: data.length };
}

function validateHowTo(md: string): string[] {
  const errors: string[] = [];
  const fm = parseFrontmatter(md);
  if (!fm) {
    errors.push("missing frontmatter");
  } else {
    for (const key of REQUIRED_FRONTMATTER) {
      if (!fm[key]) errors.push(`frontmatter missing "${key}"`);
    }
  }
  const sections = splitSections(md);
  for (const name of REQUIRED_SECTIONS) {
    const body = sections.get(name);
    if (body === undefined) {
      errors.push(`missing "## ${name}" section`);
      continue;
    }
    const table = firstTable(body);
    if (!table) {
      errors.push(`"## ${name}" has no steps table`);
      continue;
    }
    if (JSON.stringify(table.header) !== JSON.stringify(REQUIRED_HEADER)) {
      errors.push(
        `"## ${name}" table header must be | ${REQUIRED_HEADER.join(" | ")} |, got | ${table.header.join(" | ")} |`,
      );
    }
    if (table.rows < 1) errors.push(`"## ${name}" table has no steps`);
  }
  return errors;
}

const GOOD = `---
feature: Demo
phase: 03
route: /hub/demo
---

# How to: Demo

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | \`/hub/addons\` | Click **Install** | Badge shows **Installed** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | \`/hub/demo\` | Click **New** | Form opens |
`;

describe("validateHowTo (the validator itself)", () => {
  it("accepts a well-formed how-to", () => {
    expect(validateHowTo(GOOD)).toEqual([]);
  });

  it.each(REQUIRED_FRONTMATTER)("rejects frontmatter without %s", (key) => {
    const bad = GOOD.replace(new RegExp(`^${key}:.*\\n`, "m"), "");
    expect(validateHowTo(bad).join("\n")).toContain(`"${key}"`);
  });

  it("rejects a file with no frontmatter", () => {
    expect(validateHowTo(GOOD.replace(/^---[\s\S]*?---\n/, ""))).toContain(
      "missing frontmatter",
    );
  });

  it.each(REQUIRED_SECTIONS)("rejects a missing ## %s section", (name) => {
    const bad = GOOD.replace(`## ${name}\n`, "## Other\n");
    expect(validateHowTo(bad)).toContain(`missing "## ${name}" section`);
  });

  it("rejects a three-column (or renamed) table header", () => {
    const bad = GOOD.replace(
      "| # | Screen / route | Action | Expected result |\n|---|---|---|---|\n| 1 | `/hub/addons` | Click **Install** | Badge shows **Installed** |",
      "| Screen / route | Action | Result |\n|---|---|---|\n| `/hub/addons` | Click **Install** | Installed |",
    );
    expect(validateHowTo(bad).join("\n")).toMatch(/Activate.*header/);
  });

  it("rejects a table with zero steps", () => {
    const bad = GOOD.replace(
      "| 1 | `/hub/demo` | Click **New** | Form opens |\n",
      "",
    );
    expect(validateHowTo(bad)).toContain('"## Use" table has no steps');
  });

  it("rejects a section with no table at all", () => {
    const bad = GOOD.replace(/## Use\n[\s\S]*$/, "## Use\n\nJust prose.\n");
    expect(validateHowTo(bad)).toContain('"## Use" has no steps table');
  });

  it("accepts prettier-padded tables", () => {
    const padded = GOOD.replace(
      "| # | Screen / route | Action | Expected result |",
      "| #   | Screen / route   | Action   | Expected result   |",
    );
    expect(validateHowTo(padded)).toEqual([]);
  });
});

function listHowTos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listHowTos(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

const realHowTos = listHowTos(howtoDir).filter(
  (f) => !["README.md", "TEMPLATE.md"].includes(path.basename(f)),
);

describe("docs/how-to (D110, PLAT-07)", () => {
  it("has a README stating the rule", () => {
    const readme = readFileSync(path.join(howtoDir, "README.md"), "utf8");
    expect(readme.toLowerCase()).toContain("not done");
  });

  it("TEMPLATE.md conforms to the rule it teaches", () => {
    const tpl = readFileSync(path.join(howtoDir, "TEMPLATE.md"), "utf8");
    expect(validateHowTo(tpl)).toEqual([]);
  });

  // Zero real how-tos is valid in P1; it.each on [] would register nothing.
  if (realHowTos.length > 0) {
    it.each(realHowTos.map((f) => [path.relative(repoRoot, f), f]))(
      "%s is a valid how-to",
      (_rel, file) => {
        expect(validateHowTo(readFileSync(file, "utf8"))).toEqual([]);
      },
    );
  } else {
    it("has no real how-tos yet (allowed in P1)", () => {
      expect(realHowTos).toEqual([]);
    });
  }
});
