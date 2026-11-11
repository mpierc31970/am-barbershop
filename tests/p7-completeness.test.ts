// P7 exit doc completeness (07-33 choice 11; D110 / PLAT-07 how-tos, D174 / D175 MONITOR brief,
// CLAUDE.md Definition of done). Reads files only and checks P7 sections (`### P7 · 07-NN`)
// only, so later phases' pending sections never trip it. A later phase copies this file for its
// own sections rather than widening this one. Format of each how-to is tests/howto.test.ts's job.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const P7_HOWTOS = [
  "block-gallery",
  "block-slider",
  "block-tabs",
  "block-logo-strip",
  "block-stats",
  "block-map",
  "block-table",
  "block-faq",
  "block-icon-list",
  "block-hours",
  "block-social",
  "item-video",
  "item-audio",
  "item-form",
  "item-embed",
  "media-library",
  "video-upload",
  "forms",
  "inbox",
  "contacts",
  "cookie-consent",
  "site-navigation",
  "site-footer",
  "site-settings",
  "media-staff-tools",
  "site-history",
  "seo-and-sharing",
  "site-search",
  "password-pages",
  "page-not-found",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("P7 doc completeness (07-33)", () => {
  it.each(P7_HOWTOS)(
    "how-to docs/how-to/%s.md exists and is non-empty",
    (name) => {
      const rel = `docs/how-to/${name}.md`;
      expect(existsSync(path.join(root, rel)), rel).toBe(true);
      expect(read(rel).trim().length).toBeGreaterThan(0);
    },
  );

  it("every P7 training module has entries whose how-to exists", async () => {
    const dir = path.join(root, "packages/core/training/p7");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const mod = (await import(pathToFileURL(path.join(dir, f)).href)) as {
        entries?: readonly { howTo: string }[];
        features?: readonly string[];
      };
      expect(Array.isArray(mod.entries), `${f} entries`).toBe(true);
      expect(Array.isArray(mod.features), `${f} features`).toBe(true);
      expect(mod.entries!.length, `${f} has entries`).toBeGreaterThan(0);
      for (const e of mod.entries!) {
        expect(existsSync(path.join(root, e.howTo)), `${f}: ${e.howTo}`).toBe(
          true,
        );
      }
    }
  });

  it("no hub file imports SHELL_PANEL_BODY (07-03 relay)", () => {
    const hub = path.join(root, "apps/web/app/(platform)/hub");
    const offenders = walk(hub).filter((f) =>
      /import[^;]*\bSHELL_PANEL_BODY\b[^;]*from/s.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});
