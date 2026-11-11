import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CLAUDE.md carries the invariants and real commands; invariants must never be silently dropped.

const repoRoot = path.resolve(import.meta.dirname, "..");
const claude = readFileSync(path.join(repoRoot, "CLAUDE.md"), "utf8");
const scripts = (
  JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

function commandsSection(): string {
  const start = claude.indexOf("\n## Commands");
  if (start === -1) return "";
  const next = claude.indexOf("\n## ", start + 1);
  return claude.slice(start, next === -1 ? undefined : next);
}

describe("CLAUDE.md", () => {
  it("has exactly one ## Commands section", () => {
    expect(claude.match(/^## Commands\s*$/gm)?.length).toBe(1);
  });

  it.each([
    "npm ci",
    "npm run build",
    "npm run lint",
    "npm test",
    "npx vitest run --project unit",
    "npm run dev -w @cds/web",
    "npm run db:migrations:assemble",
  ])("documents %s", (cmd) => {
    expect(commandsSection()).toContain(cmd);
  });

  it("documents only root scripts that exist in package.json", () => {
    const documented = [
      ...commandsSection().matchAll(/npm run ([\w:-]+)( -w)?/g),
    ]
      .filter((m) => !m[2]) // workspace scripts (-w) live in that package
      .map((m) => m[1]);
    expect(documented.length).toBeGreaterThan(0);
    for (const name of documented) {
      expect(Object.keys(scripts), `npm run ${name}`).toContain(name);
    }
    expect(scripts.test, "npm test").toBeDefined();
  });

  it.each([
    "## Invariants",
    "## Working preferences",
    "One chokepoint owns all database access",
    "Installing an add-on is never a migration",
    "Add-ons are isolated packages",
    "Two separate user populations",
    "Never use worktrees",
  ])("still contains %s", (text) => {
    expect(claude).toContain(text);
  });
});
