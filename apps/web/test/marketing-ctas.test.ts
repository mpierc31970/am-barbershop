// 15-22 choice 6 (HUB-02): every hub CTA enters /start with only valid params.
// Part 1 walks the marketing sources for `/start` href literals; part 2 renders home, a path page
// and the add-ons rack with the shared mocks (P15-P27, imported first) and checks every link
// labelled "Start your site", "Start on …" or "Add to my site".
import { mockMarketingData } from "./helpers/marketing-mocks";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "../app/(platform)/(marketing)/page";
import { PathPage } from "../app/(platform)/(marketing)/_components/PathPage";
import AddonsPage from "../app/(platform)/(marketing)/add-ons/page";

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

vi.spyOn(console, "error").mockImplementation(() => {});

const root = join(import.meta.dirname, "..", "..", "..");

function walk(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

const SOURCES = [
  ...walk("apps/web/app/(platform)/(marketing)").filter((f) =>
    f.endsWith(".tsx"),
  ),
  ...walk("packages/ui/src/marketing").filter(
    (f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f),
  ),
  "packages/core/src/marketing/copy.ts",
  "packages/core/src/marketing/paths.ts",
  "apps/web/lib/marketing-catalog.ts",
];

const VALID_LITERAL =
  /^\/start(\?(path=(standard|studio)|addon=[a-z0-9-]+|addon=\$\{[^}]+\}))?$/;

describe("/start href literals in marketing sources (HUB-02)", () => {
  it("finds the sources", () => {
    expect(SOURCES.length).toBeGreaterThan(20);
    for (const f of SOURCES) expect(existsSync(join(root, f)), f).toBe(true);
  });

  it("every /start literal carries only a valid path or addon param", () => {
    let count = 0;
    for (const f of SOURCES) {
      const src = readFileSync(join(root, f), "utf8");
      for (const m of src.matchAll(/["'`](\/start(?:[?/#][^"'`]*)?)["'`]/g)) {
        count += 1;
        expect(m[1], relative(root, join(root, f))).toMatch(VALID_LITERAL);
      }
    }
    // Header, mobile menu, paths, blade, rack, catalog builder and several pages.
    expect(count).toBeGreaterThanOrEqual(10);
  });
});

type Link = { href: string; text: string };

function links(html: string): Link[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: (/\bhref="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? "").replace(
      /&amp;/g,
      "&",
    ),
    text: (m[2] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim(),
  }));
}

const CTA = /^(Start your site|Start on |Add to my site)/;

function ctas(html: string): Link[] {
  return links(html).filter((l) => CTA.test(l.text));
}

function expectStart(found: Link[]): void {
  expect(found.length).toBeGreaterThan(0);
  for (const l of found) {
    expect(l.href.startsWith("/start"), `${l.text} → ${l.href}`).toBe(true);
    expect(l.href, l.text).toMatch(
      /^\/start(\?(path=(standard|studio)|addon=[a-z0-9-]+))?$/,
    );
  }
}

beforeEach(() => {
  mockMarketingData();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rendered CTAs enter /start (HUB-02)", () => {
  it("home", async () => {
    const html = renderToStaticMarkup((await HomePage()) as ReactElement);
    const found = ctas(html);
    expectStart(found);
    expect(found.some((l) => l.text.startsWith("Start your site"))).toBe(true);
  });

  it.each(["standard", "studio"] as const)("path page %s", async (path) => {
    const html = renderToStaticMarkup(
      (await PathPage({ path })) as ReactElement,
    );
    const found = ctas(html);
    expectStart(found);
    expect(found.some((l) => l.href === `/start?path=${path}`)).toBe(true);
  });

  it("add-ons rack", async () => {
    const html = renderToStaticMarkup(
      (await AddonsPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );
    const found = ctas(html);
    expectStart(found);
    expect(found.some((l) => l.text.startsWith("Add to my site"))).toBe(true);
  });
});
