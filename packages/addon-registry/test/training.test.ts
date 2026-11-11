// Add-on training coverage (ADDON-10, D110; RESEARCH Pitfall 10; invariant 4). Every add-on
// training entry points at a real docs/how-to/addon-*.md whose Use steps are baked into the
// generated data, so training renders without docs/ in the standalone bundle.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_TRAINING } from "@cds/core/training";
import { ADDON_REGISTRY, howToSteps } from "../src/index";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function frontmatter(md: string): Record<string, string> {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.indexOf("---", 1);
  const out: Record<string, string> = {};
  for (const line of lines.slice(1, end === -1 ? 0 : end)) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

const entries = ADDON_REGISTRY.list().flatMap((m) =>
  m.training.map((e) => ({ slug: m.slug, entry: e })),
);

describe("add-on training (ADDON-10)", () => {
  it("has unique training ids across core and every add-on", () => {
    const ids = [
      ...CORE_TRAINING.map((e) => e.id),
      ...entries.map((e) => e.entry.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns no steps for an unknown or core how-to", () => {
    expect(howToSteps("docs/how-to/popups.md")).toEqual([]);
    expect(howToSteps("__proto__")).toEqual([]);
  });

  if (entries.length === 0) {
    it("has no add-on training yet (allowed until 05-07)", () => {
      expect(ADDON_REGISTRY.list()).toEqual([]);
    });
    return;
  }

  it.each(entries.map((e) => [`${e.slug}:${e.entry.id}`, e]))(
    "%s points at a baked addon how-to",
    (_label, { entry }) => {
      // addon-*.md, or one of gen.mjs EXTRA_ADDON_HOWTOS (10-42: pro-table.md).
      expect(entry.howTo).toMatch(
        /^docs\/how-to\/(?:addon-[a-z0-9-]+|pro-table)\.md$/,
      );
      const file = path.join(repoRoot, entry.howTo);
      expect(existsSync(file), entry.howTo).toBe(true);
      const fm = frontmatter(readFileSync(file, "utf8"));
      expect(fm.feature, entry.howTo).toBeTruthy();
      expect(fm.phase, entry.howTo).toBeTruthy();
      expect(fm.route, entry.howTo).toBeTruthy();
      expect(howToSteps(entry.howTo).length).toBeGreaterThanOrEqual(1);
    },
  );
});
