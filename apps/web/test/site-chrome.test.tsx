// 07-26 Task 2: <html lang> in the root layout (CONT-29; choice 5; T-07-26-02/03), the
// hideTranslate marker on <main> (CONT-34; choice 8) and the per-request siteForRoute memo.
import { TENANT_HOST_HEADER } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { PageRenderer } from "@cds/ui/site";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  header: null as string | null,
  memo: new Map<string, unknown>(),
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(
      state.header === null ? {} : { "x-cds-tenant-host": state.header },
    ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));
// React's cache() only memoises inside a server render; stand in a per-"request" memo.
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return {
    ...real,
    cache:
      <A extends unknown[], R>(fn: (...a: A) => R) =>
      (...a: A): R => {
        const key = JSON.stringify(a);
        if (!state.memo.has(key)) state.memo.set(key, fn(...a));
        return state.memo.get(key) as R;
      },
  };
});
vi.mock("../app/globals.css", () => ({}));

const db = vi.hoisted(() => ({
  siteContextForHost: vi.fn(),
  readPublicSiteSettings: vi.fn(),
  readPublicPopups: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { default: RootLayout } = await import("../app/layout");
const { siteForRoute } = await import("../lib/tenant");

const SITE = { orgId: "o1", host: "rivera.com" };

function settings(language: string) {
  return {
    banner: null,
    nav: null,
    footer: null,
    settings: {
      language,
      show_translate: false,
      show_search: false,
      allow_ai_crawlers: true,
    },
  };
}

async function rootHtml(): Promise<string> {
  return renderToStaticMarkup(
    (await RootLayout({ children: <p>x</p> })) as ReactElement,
  );
}

beforeEach(() => {
  state.header = null;
  state.memo.clear();
  for (const f of Object.values(db)) f.mockReset();
  db.readPublicPopups.mockResolvedValue([]);
});

describe("root layout <html lang> (07-26 choice 5)", () => {
  it("uses the shared header name", () => {
    expect(TENANT_HOST_HEADER).toBe("x-cds-tenant-host");
  });

  it("a tenant request gets the site's language", async () => {
    state.header = "rivera.com";
    db.siteContextForHost.mockResolvedValue(SITE);
    db.readPublicSiteSettings.mockResolvedValue(settings("es"));
    expect(await rootHtml()).toMatch(/^<html lang="es">/);
  });

  it("the hub (no header) stays en and reads no settings", async () => {
    expect(await rootHtml()).toMatch(/^<html lang="en">/);
    expect(db.siteContextForHost).not.toHaveBeenCalled();
    expect(db.readPublicSiteSettings).not.toHaveBeenCalled();
  });

  it("an unresolved host -> en", async () => {
    state.header = "nobody.com";
    db.siteContextForHost.mockResolvedValue(null);
    expect(await rootHtml()).toMatch(/^<html lang="en">/);
    expect(db.readPublicSiteSettings).not.toHaveBeenCalled();
  });

  it("a failing settings read -> en, never a 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.header = "rivera.com";
    db.siteContextForHost.mockResolvedValue(SITE);
    db.readPublicSiteSettings.mockRejectedValue(new Error("pb down"));
    expect(await rootHtml()).toMatch(/^<html lang="en">/);
    log.mockRestore();
  });

  it("a failing host lookup -> en", async () => {
    state.header = "rivera.com";
    db.siteContextForHost.mockRejectedValue(new Error("pb down"));
    expect(await rootHtml()).toMatch(/^<html lang="en">/);
  });
});

describe("siteForRoute memo (React cache)", () => {
  it("one host lookup per request for the same host", async () => {
    state.header = "rivera.com";
    db.siteContextForHost.mockResolvedValue(SITE);
    await siteForRoute("rivera.com");
    await siteForRoute("rivera.com");
    expect(db.siteContextForHost).toHaveBeenCalledTimes(1);
  });
});

describe("PageRenderer hideTranslate marker (CONT-34)", () => {
  const registry = composeSectionRegistry(CORE_SECTIONS, []);
  const page = {
    version: 1,
    page: {
      id: "p",
      slug: "p",
      title: "P",
      seo: {},
      password_protected: false,
    },
    sections: [],
    published_at: "",
  } as never;

  it("puts the marker on <main> for a flagged kind", () => {
    const html = renderToStaticMarkup(
      <PageRenderer
        page={page}
        registry={registry}
        now={new Date()}
        hideTranslate
      />,
    );
    expect(html).toMatch(/<main id="content"[^>]*data-cds-hide-translate=""/);
  });

  it("no marker by default", () => {
    const html = renderToStaticMarkup(
      <PageRenderer page={page} registry={registry} now={new Date()} />,
    );
    expect(html).not.toContain("data-cds-hide-translate");
  });
});
