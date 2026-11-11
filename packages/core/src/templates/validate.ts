// Template shape check and path pick (CONTEXT A1-Q5, shape half; T-08-01-03). Runs before
// any write. Block-type checks are not here: slots are functions, so 08-14's fixture test
// fills every slot and validates the blocks through the composed registry.
import { InvalidInput } from "../errors";
import type { SiteTemplate } from "./types";

export function assertTemplateShape(t: SiteTemplate): void {
  const bad = (why: string): never => {
    throw new InvalidInput(`Template ${t.id}: ${why}`);
  };
  if (!Number.isInteger(t.version) || t.version < 1) {
    bad("version must be a positive integer");
  }
  if (t.paths.length === 0) bad("lists no path");
  if (!t.pages.some((p) => p.key === "home")) bad("has no home page");
  const keys = new Set<string>();
  const slugs = new Set<string>();
  for (const p of t.pages) {
    if (keys.has(p.key)) bad(`duplicate page key ${p.key}`);
    if (slugs.has(p.slug)) bad(`duplicate page slug ${p.slug}`);
    keys.add(p.key);
    slugs.add(p.slug);
    const names = new Set<string>();
    for (const s of p.slots) {
      if (names.has(s.name)) bad(`duplicate slot ${s.name} on ${p.key}`);
      names.add(s.name);
    }
  }
}

/** The first template that lists the org's path; undefined when none does. */
export function pickTemplate(
  templates: readonly SiteTemplate[],
  path: string,
): SiteTemplate | undefined {
  return templates.find((t) => (t.paths as readonly string[]).includes(path));
}
