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

/** Body of each `### P7 · 07-NN …` heading, up to the next `###` or `##`. */
function p7Sections(doc: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const lines = doc.split(/\r?\n/);
  let current: string | null = null;
  for (const line of lines) {
    const m = /^### P7 · 07-(\d\d)\b/.exec(line);
    if (m) {
      current = m[1]!;
      const prev = out.get(current);
      out.set(current, prev ? [...prev, "\u0000DUP"] : []);
      continue;
    }
    if (/^#{2,3} /.test(line)) {
      current = null;
      continue;
    }
    if (current) out.get(current)!.push(line);
  }
  return out;
}

const PLAN_NUMBERS = Array.from({ length: 33 - 6 + 1 }, (_, i) =>
  String(i + 6).padStart(2, "0"),
);

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

  for (const doc of [".planning/GO-LIVE.md", ".planning/HUMAN-CHECKS.md"]) {
    it(`${doc}: every P7 · 07-06…07-33 section exists once and is filled`, () => {
      const sections = p7Sections(read(doc));
      for (const nn of PLAN_NUMBERS) {
        const body = sections.get(nn);
        expect(body, `${doc} ### P7 · 07-${nn}`).toBeDefined();
        expect(body!.includes("\u0000DUP"), `${doc} 07-${nn} duplicated`).toBe(
          false,
        );
        expect(
          body!.some((l) => /_Pending/.test(l)),
          `${doc} 07-${nn} still pending`,
        ).toBe(false);
        expect(
          body!.some((l) => l.trim().length > 0),
          `${doc} 07-${nn} empty`,
        ).toBe(true);
      }
    });
  }

  it("GO-LIVE names every P7 account, key and job", () => {
    const g = read(".planning/GO-LIVE.md");
    for (const needle of [
      "BUNNY_",
      "WASABI_MEDIA_BUCKET",
      "CDS_MEDIA_TOKEN_SECRET",
      "ffmpeg",
      "ClamAV",
      "GOOGLE_MAPS_EMBED_KEY",
      "PEXELS",
      "CDS_STAFF_ALERT_EMAIL",
      "/api/jobs/media",
    ]) {
      expect(g, needle).toContain(needle);
    }
    expect(/UNSPLASH_ACCESS_KEY|Unsplash/.test(g)).toBe(true);
  });

  it("HUMAN-CHECKS covers breakpoints, Lighthouse, the P7 migrations and @lhci/cli", () => {
    const h = read(".planning/HUMAN-CHECKS.md");
    for (const needle of [
      "375",
      "1440",
      "Lighthouse",
      "1790000630",
      "1790000640",
      "@lhci/cli",
    ]) {
      expect(h, needle).toContain(needle);
    }
  });

  it("the MONITOR brief lists every P7 monitored item", () => {
    const m = read(".planning/design/MONITOR-APP-BRIEF.md");
    for (const needle of [
      "/api/jobs/media",
      "ffmpeg",
      "cdn_status",
      "fallback_active",
    ]) {
      expect(m, needle).toContain(needle);
    }
    expect(/virus scanner/i.test(m)).toBe(true);
  });

  it("CLAUDE.md Commands documents --blocks, lighthouse and the media staff tools", () => {
    const c = read("CLAUDE.md");
    const start = c.indexOf("\n## Commands");
    const next = c.indexOf("\n## ", start + 1);
    const commands = c.slice(start, next === -1 ? undefined : next);
    for (const needle of [
      "--blocks",
      "npm run lighthouse",
      "media:usage",
      "media:takedown",
    ]) {
      expect(commands, needle).toContain(needle);
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
