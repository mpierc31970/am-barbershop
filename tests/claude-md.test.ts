import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// PLAT-05 / D50: CLAUDE.md carries the invariants, real commands and the
// definition of done. T-01-14: invariants must never be silently dropped.

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

describe("CLAUDE.md (PLAT-05)", () => {
  it("no longer carries the P1 placeholder", () => {
    expect(claude).not.toContain("established in P1; fill them in here then");
  });

  it("has exactly one ## Commands section", () => {
    expect(claude.match(/^## Commands\s*$/gm)?.length).toBe(1);
  });

  it.each([
    "npm run build",
    "npm run lint",
    "npm test",
    "npm run typecheck",
    "npm run format",
    "npm run db:pb:fetch",
    "npm run db:migrate:dev",
    "npx vitest run --project unit",
    "npm run dev -w @cds/web",
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

  it("has a definition of done that requires a how-to", () => {
    const i = claude.search(/definition of done/i);
    expect(i).toBeGreaterThan(-1);
    const dod = claude.slice(i, i + 1200);
    expect(dod).toMatch(/how-to/);
    expect(dod).toContain("docs/how-to/");
  });

  it.each([
    "## Architectural invariants",
    "## Working preferences",
    "## Unattended build mode",
    "One chokepoint owns all database access",
    "Never branch or version per tenant",
    "Installing an add-on is never a migration",
    "Add-ons are isolated packages",
    "Two separate user populations",
  ])("still contains %s", (text) => {
    expect(claude).toContain(text);
  });
});
