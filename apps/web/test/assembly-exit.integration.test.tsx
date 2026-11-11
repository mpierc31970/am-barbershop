// Phase 8 exit (08-19 Task 2; TMPL-01..04; ROADMAP P8 exit; CONTEXT A4-Q4; D57, D170, D253;
// D-UI-P8-8, D-UI-P8-12; T-08-19-02, T-08-19-03). Both P6 intake fixtures (complete and
// minimal) are seeded, sent to CDS and assembled by seedAssembledIntake (the same helper the
// `tenants:seed-dev -- --intake both --assemble` CLI and the Lighthouse runner use), then `/`
// and `/about` are rendered by preview host (x-cds-tenant-host) through the real route tree
// (root layout > tenant layout > tenant page) against the PocketBase 0.39.11 binary.
// No manual authoring anywhere: the only writes are the intake fixture and the assembly.
//
// Known gaps (it.fails, so each one turns red the day it is fixed and the marker is removed;
// listed in 08-19-SUMMARY "Gaps for gap closure"):
//   G1 (closed by 08-REVIEW CR-B01) the hero "Get in touch" href is now /#form-<itemId>,
//      the P7 form item wrapper id (07 choice 2), so the anchor lands on the contact form.
//   G2 the "Preview: in development, not live yet" strip (DOM-09, D170) is not built yet;
//      preview pages are noindex already.
//
// Skips locally without the PocketBase binary; fails in CI (bootPb throws there).
// next/headers supplies the middleware header; next/navigation throws sentinels;
// next/cache is a passthrough.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearResolverCache,
  listPageVersions,
  listPages,
  orgContextFromToken,
  signInMember,
  tenantPublishedPageKey,
  type OrgContext,
} from "@cds/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ASSEMBLY_FIXTURES,
  seedAssembledIntake,
  type AssemblyFixture,
  type SeedAssemblyResult,
} from "../../../packages/db/scripts/seed-assembly";
import type { PbInstance } from "../../../packages/db/test/pb-harness";
import { bootSeededPb } from "../../../packages/db/test/seeded";

type Dom = { window: { document: Document } };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => Dom;
};

const state = vi.hoisted(() => ({ header: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      ...(state.header === null ? {} : { "x-cds-tenant-host": state.header }),
      "x-real-ip": "203.0.113.19",
    }),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT_308:${to}`);
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

const pageModule = await import("../app/tenant/[host]/[[...path]]/page");
const TenantPage = pageModule.default;
const { default: TenantLayout } = await import("../app/tenant/[host]/layout");
const { default: RootLayout } = await import("../app/layout");

const OWNER_PW = `owner-${Math.random().toString(36).slice(2)}-pw`;
const FIXTURES = ["complete", "minimal"] as const;
const PAGES = { home: undefined, about: ["about"] } as const;
type PageKey = keyof typeof PAGES;
const PAGE_KEYS = Object.keys(PAGES) as PageKey[];
const BUSINESS: Record<AssemblyFixture, string> = {
  complete: "Rivera Bakery",
  minimal: "Juniper Tutoring",
};

/** D-UI-P8-12 plus the three owner helper strings (D-UI-P8-8): never visible text. */
const FORBIDDEN_TEXT: (string | RegExp)[] = [
  /lorem/i,
  /\bundefined\b/,
  /\bnull\b/,
  "{",
  "Add your address and phone in Settings",
  "Add services in Website",
  "Add team members in Settings",
];

type Built = {
  seed: SeedAssemblyResult;
  ctx: OrgContext;
  html: Record<PageKey, string>;
  doc: Record<PageKey, Document>;
};

let inst: PbInstance | null = null;
let privDir = "";
let pubDir = "";
const built = {} as Record<AssemblyFixture, Built>;

function dom(markup: string): Document {
  return new JSDOM(markup).window.document;
}

async function renderFull(
  host: string,
  path?: readonly string[],
): Promise<string> {
  state.header = host;
  const p = path ? [...path] : undefined;
  const page = await TenantPage({
    params: Promise.resolve({ host, path: p }),
  });
  const site = await TenantLayout({
    children: page as ReactElement,
    params: Promise.resolve({ host }),
  });
  const root = await RootLayout({ children: site as ReactElement });
  return renderToStaticMarkup(root as ReactElement);
}

async function meta(host: string, path?: readonly string[]) {
  state.header = host;
  return pageModule.generateMetadata({
    params: Promise.resolve({ host, path: path ? [...path] : undefined }),
  });
}

/** Visible text: scripts (RSC payload, JSON-LD), styles and noscript removed first. */
function visibleText(doc: Document): string {
  const copy = doc.body.cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll("script, style, noscript, template")) {
    el.remove();
  }
  return copy.textContent ?? "";
}

function main(doc: Document): Element {
  const m = doc.querySelector("main#content");
  expect(m).not.toBeNull();
  return m!;
}

/** Top-level page sections, in order, with their band and first heading. */
function bands(doc: Document): { band: string; heading: string }[] {
  return [...main(doc).querySelectorAll(":scope > section")].map((s) => ({
    band: s.getAttribute("data-band") ?? "",
    heading: s.querySelector("h1, h2")?.textContent?.trim() ?? "",
  }));
}

/** Sections that share a slot with the section before them (two-block slots). */
const SECOND_BLOCK_OF_SLOT = new Set([
  "Find us", // hours-location's Map, or the Contact preset's Map
  "Our mission", // the about slot's mission block
]);

function storedJson(orgId: string, pageId: string): string {
  const parts = tenantPublishedPageKey(orgId, pageId).split("/");
  for (const dir of [privDir, pubDir]) {
    const file = join(dir, ...parts);
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error(`no published JSON for page ${pageId}`);
}

beforeAll(async () => {
  privDir = mkdtempSync(join(tmpdir(), "cds-assembly-exit-"));
  pubDir = mkdtempSync(join(tmpdir(), "cds-assembly-exit-pub-"));
  vi.stubEnv("CDS_STORAGE_DIR", privDir);
  vi.stubEnv("CDS_PUBLIC_STORAGE_DIR", pubDir);
  vi.stubEnv("CDS_ENV", "dev");
  vi.stubEnv("CDS_PREVIEW_HOST_SUFFIX", "sites.localhost");
  vi.stubEnv("CDS_PREVIEW_PORT", "");
  vi.stubEnv("CDS_MEDIA_TOKEN_SECRET", "assembly-exit-".padEnd(48, "s"));
  vi.stubEnv("CDS_MEDIA_CDN", "");
  const booted = await bootSeededPb();
  if (!booted) return;
  inst = booted.inst;
  for (const which of FIXTURES) {
    const seed = await seedAssembledIntake(which, { ownerPassword: OWNER_PW });
    const { token } = await signInMember(
      ASSEMBLY_FIXTURES[which].ownerEmail,
      OWNER_PW,
      "203.0.113.9",
    );
    const ctx = await orgContextFromToken(token, seed.orgId, "203.0.113.9");
    clearResolverCache();
    const html = {} as Record<PageKey, string>;
    const doc = {} as Record<PageKey, Document>;
    for (const key of PAGE_KEYS) {
      html[key] = await renderFull(seed.previewHost, PAGES[key]);
      doc[key] = dom(html[key]);
    }
    built[which] = { seed, ctx, html, doc };
  }
}, 240_000);

afterAll(async () => {
  await inst?.stop();
  vi.unstubAllEnvs();
  if (privDir) rmSync(privDir, { recursive: true, force: true });
  if (pubDir) rmSync(pubDir, { recursive: true, force: true });
});

describe("P8 exit: a finished intake becomes a reviewable site, no manual authoring", () => {
  it("both fixtures assemble onto their sites.localhost preview hosts", (t) => {
    if (!inst) return t.skip();
    for (const which of FIXTURES) {
      const { seed } = built[which];
      expect(seed.result.status, which).toBe("done");
      expect(seed.previewHost).toBe(
        `${ASSEMBLY_FIXTURES[which].slug}.sites.localhost`,
      );
    }
  });

  it("/ and /about render with exactly one H1 each and no skipped heading level", (t) => {
    if (!inst) return t.skip();
    for (const which of FIXTURES) {
      const name = BUSINESS[which];
      const { doc } = built[which];
      for (const key of PAGE_KEYS) {
        const h1s = doc[key].querySelectorAll("h1");
        expect(h1s, `${which} ${key}`).toHaveLength(1);
        expect(h1s[0]!.textContent?.trim()).toBe(
          key === "home" ? name : `About ${name}`,
        );
        // Inside <main>: H1 -> h2 -> h3, never a jump (UI-SPEC accessibility contract).
        let prev = 1;
        for (const h of main(doc[key]).querySelectorAll("h1,h2,h3,h4,h5,h6")) {
          const level = Number(h.tagName.slice(1));
          expect(
            level - prev,
            `${which} ${key} ${h.textContent}`,
          ).toBeLessThanOrEqual(1);
          prev = level;
        }
      }
    }
  });

  it("nav is Home + About; preview pages are noindex (D57, D170)", async (t) => {
    if (!inst) return t.skip();
    for (const which of FIXTURES) {
      const { doc, seed } = built[which];
      for (const key of PAGE_KEYS) {
        const nav = doc[key].querySelector('header nav[aria-label="Main"]');
        expect(nav, `${which} ${key}`).not.toBeNull();
        const links = [...nav!.querySelectorAll("a")].map((a) => [
          a.getAttribute("href"),
          a.textContent?.trim(),
        ]);
        expect(links).toEqual([
          ["/", "Home"],
          ["/about", "About"],
        ]);
        const m = await meta(seed.previewHost, PAGES[key]);
        expect(m.robots, `${which} ${key}`).toEqual({
          index: false,
          follow: false,
        });
      }
    }
  });

  // G2: DOM-09 (P14) builds the strip; preview pages are already noindex (above).
  it.fails("preview pages carry the in-development strip (G2, DOM-09)", (t) => {
    if (!inst) throw new Error("no PocketBase binary");
    void t;
    for (const which of FIXTURES) {
      for (const key of PAGE_KEYS) {
        expect(visibleText(built[which].doc[key])).toContain(
          "in development, not live yet",
        );
      }
    }
  });

  it("COMPLETE Home: eager hero photo, 3 services with prices, hours, contact form, tel: link", (t) => {
    if (!inst) return t.skip();
    const doc = built.complete.doc.home;
    const m = main(doc);
    const hero = m.querySelector("section");
    const heroImg = hero!.querySelector("img");
    expect(heroImg).not.toBeNull();
    expect(heroImg!.getAttribute("loading")).toBe("eager");
    expect(heroImg!.getAttribute("fetchpriority")).toBe("high");
    expect(heroImg!.getAttribute("alt")).not.toBe("");

    const services = [...m.querySelectorAll("section")].find(
      (s) => s.querySelector("h2")?.textContent === "What we offer",
    );
    expect(services).toBeDefined();
    const items = services!.querySelectorAll("ul > li");
    expect(items).toHaveLength(3);
    for (const li of items) {
      expect(li.querySelector("h3")?.textContent).not.toBe("");
      expect(li.textContent).toMatch(/\$\d+/);
    }

    const headings = bands(doc).map((b) => b.heading);
    expect(headings).toContain("Opening hours");
    expect(m.querySelector("table caption")?.textContent).toBe("Opening hours");
    expect(m.querySelector("form[data-cds-form]")).not.toBeNull();
    expect(m.querySelector('a[href^="tel:"]')).not.toBeNull();
    // WR-B01: the contact column's mailto: link survives save (a Button, not rich text).
    expect(m.querySelector('a[href^="mailto:"]')).not.toBeNull();
  });

  it("the hero Get in touch link is /#form-<itemId>, never the form record id", (t) => {
    if (!inst) return t.skip();
    for (const which of FIXTURES) {
      const m = main(built[which].doc.home);
      const cta = [...m.querySelectorAll("section a")].find(
        (a) => a.textContent?.trim() === "Get in touch",
      );
      expect(cta, which).toBeDefined();
      const formId = m
        .querySelector("form[data-cds-form]")!
        .getAttribute("data-cds-form");
      const href = cta!.getAttribute("href")!;
      expect(href, which).toMatch(/^\/#form-./);
      expect(href, which).not.toBe(`/#form-${formId}`);
    }
  });

  // G1 (CR-B01): the anchor target exists and wraps the contact form.
  it("the hero Get in touch anchor lands on the form (G1)", (t) => {
    if (!inst) return t.skip();
    for (const which of FIXTURES) {
      const doc = built[which].doc.home;
      const cta = [...main(doc).querySelectorAll("section a")].find(
        (a) => a.textContent?.trim() === "Get in touch",
      )!;
      const id = cta.getAttribute("href")!.split("#")[1]!;
      const target = doc.getElementById(id);
      expect(target, which).not.toBeNull();
      expect(target!.querySelector("form")).not.toBeNull();
    }
  });

  it("bands: Home starts alternate; adjacent equal bands only inside a two-block slot (D-UI-P8-5)", (t) => {
    if (!inst) return t.skip();
    for (const which of FIXTURES) {
      for (const key of PAGE_KEYS) {
        const seq = bands(built[which].doc[key]);
        expect(seq.length, `${which} ${key}`).toBeGreaterThan(1);
        if (key === "home") expect(seq[0]!.band).toBe("alternate");
        for (let i = 1; i < seq.length; i++) {
          expect(["main", "alternate"]).toContain(seq[i]!.band);
          if (seq[i]!.band === seq[i - 1]!.band) {
            expect(
              SECOND_BLOCK_OF_SLOT.has(seq[i]!.heading),
              `${which} ${key}: "${seq[i - 1]!.heading}" and "${seq[i]!.heading}" share a band`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("COMPLETE About: Our team (2, live from the team list, D253), gallery, answered FAQ, contact", (t) => {
    if (!inst) return t.skip();
    const m = main(built.complete.doc.about);
    const team = [...m.querySelectorAll("section")].find(
      (s) => s.querySelector("h2")?.textContent === "Our team",
    );
    expect(team).toBeDefined();
    const members = team!.querySelectorAll("ul > li");
    expect(members).toHaveLength(2);
    expect(
      [...members].map((li) => li.querySelector("h3")?.textContent),
    ).toEqual(["Ana Rivera", "Sam Ortiz"]);
    expect(m.querySelector("[data-gallery-photo]")).not.toBeNull();
    expect(m.querySelectorAll("[data-gallery-photo]")).toHaveLength(3);

    const faq = [...m.querySelectorAll("section")].find(
      (s) => s.querySelector("h2")?.textContent === "Questions and answers",
    );
    expect(faq).toBeDefined();
    const qa = [...faq!.querySelectorAll("details")];
    expect(qa.length).toBeGreaterThan(0);
    for (const d of qa) {
      const answer = d.querySelector("summary")?.nextElementSibling;
      expect(answer?.textContent?.trim(), d.textContent ?? "").not.toBe("");
    }
    expect(m.querySelector("form[data-cds-form]")).not.toBeNull();
  });

  it("MINIMAL: text-only hero; no Services, Our team or Gallery; contact present", (t) => {
    if (!inst) return t.skip();
    const { doc } = built.minimal;
    const home = main(doc.home);
    expect(home.querySelector("section")!.querySelector("img")).toBeNull();
    for (const key of PAGE_KEYS) {
      const m = main(doc[key]);
      const headings = bands(doc[key]).map((b) => b.heading);
      expect(headings).not.toContain("What we offer");
      expect(headings).not.toContain("Our team");
      expect(m.querySelector("[data-gallery-photo]")).toBeNull();
      expect(m.querySelector("[data-gallery-mosaic]")).toBeNull();
      expect(m.querySelector("form[data-cds-form]"), key).not.toBeNull();
      expect(visibleText(doc[key])).toContain("juniper.tutoring@gmail.com");
    }
  });

  it("no lorem, undefined, null, '{' or owner helper text in any render or published JSON (D-UI-P8-8, D-UI-P8-12)", async (t) => {
    if (!inst) return t.skip();
    for (const which of FIXTURES) {
      const { doc, ctx, seed } = built[which];
      for (const key of PAGE_KEYS) {
        const text = visibleText(doc[key]);
        for (const bad of FORBIDDEN_TEXT) {
          if (typeof bad === "string") {
            expect(text, `${which} ${key}: ${bad}`).not.toContain(bad);
          } else {
            expect(text, `${which} ${key}: ${bad}`).not.toMatch(bad);
          }
        }
      }
      // The published page JSON (the data the renderer reads) carries no placeholder either.
      for (const page of await listPages(ctx)) {
        const json = JSON.stringify(
          JSON.parse(storedJson(seed.orgId, page.id)),
        );
        expect(json, `${which} ${page.slug}`).not.toMatch(/lorem/i);
        expect(json, `${which} ${page.slug}`).not.toContain("undefined");
      }
    }
  });

  it("Home and About are published at version 1 (ledger versionKey + one stored version each)", async (t) => {
    if (!inst) return t.skip();
    for (const which of FIXTURES) {
      const { ctx, seed } = built[which];
      const pages = await listPages(ctx);
      expect(pages.map((p) => p.slug).sort(), which).toEqual(["about", "home"]);
      for (const key of PAGE_KEYS) {
        const entry = seed.result.ledger.pages[key];
        expect(entry, `${which} ${key}`).toBeDefined();
        expect(entry!.published).toBe(true);
        expect(entry!.versionKey).toBeTruthy();
        const page = pages.find((p) => p.slug === key)!;
        expect(page.id).toBe(entry!.id);
        expect(page.status).toBe("published");
        const versions = await listPageVersions(ctx, page.id);
        expect(versions, `${which} ${key}`).toHaveLength(1);
        expect(entry!.versionKey?.endsWith(`/${versions[0]!.id}.json`)).toBe(
          true,
        );
        expect(versions[0]!.who).toEqual({ kind: "assembly" });
      }
    }
  });
});
