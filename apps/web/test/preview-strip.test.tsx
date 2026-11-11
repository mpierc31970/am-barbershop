// 14-19 (DOM-09, D170, D-UI-P14-14..16): the preview strip variants, and the tenant layout
// mounting it on preview hosts only (custom and redirect hosts never show it, T-14-19-02),
// with the draft variant only for a MAC-verified, org-matched `cds_pv` token (T-14-19-03).
import { P14_COPY } from "@cds/core/dns";
import { signPreviewToken } from "@cds/db";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  header: null as string | null,
  path: null as string | null,
  cookies: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      ...(state.header === null ? {} : { "x-cds-tenant-host": state.header }),
      ...(state.path === null ? {} : { "x-cds-tenant-path": state.path }),
    }),
  cookies: async () => ({
    get: (name: string) =>
      state.cookies[name] === undefined
        ? undefined
        : { name, value: state.cookies[name] },
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT_308:${to}`);
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

const db = vi.hoisted(() => ({
  siteContextForHost: vi.fn(),
  readSiteManifest: vi.fn(),
  readPublicSiteSettings: vi.fn(),
  readPublicDesign: vi.fn(),
  readAddonSiteState: vi.fn(),
  readPublicAddonRecords: vi.fn(),
  readPublicBusiness: vi.fn(),
  readPublicLogoId: vi.fn(),
  resolvePublicMedia: vi.fn(),
  readPublishedSitePolicy: vi.fn(),
  readPublicAnalytics: vi.fn(),
  readPublicPopups: vi.fn(),
  previewPageForLink: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { PreviewStrip, STRIP_EXPIRED_SHORT } =
  await import("../app/tenant/[host]/_chrome/PreviewStrip");
const { default: TenantLayout } = await import("../app/tenant/[host]/layout");

const ORG = "orgaaaaaaaaaaaa";
const OTHER = "orgbbbbbbbbbbbb";
const PAGE = "pageaaaaaaaaaaa";
const OTHER_PAGE = "pagebbbbbbbbbbb";
const HOST = "rivera.sites.localhost";

function strip(variant?: "normal" | "draft" | "expired"): string {
  return renderToStaticMarkup(<PreviewStrip variant={variant} />);
}

describe("PreviewStrip variants (D-UI-P14-14..16)", () => {
  it("normal: full and short copy, aside label, nothing interactive, no theme token", () => {
    const out = strip();
    expect(out).toContain('aria-label="Preview notice"');
    expect(out.startsWith("<aside")).toBe(true);
    expect(out).toContain(P14_COPY.STRIP);
    expect(out).toContain(P14_COPY.STRIP_SHORT);
    expect(out).toContain("h-8");
    expect(out).toContain("bg-hub-ink");
    expect(out).not.toMatch(/<a[\s>]|<button|<img|<svg|<script|tabindex/);
    expect(out).not.toContain("site-");
  });

  it("draft: unpublished-changes copy on the warning tint with a bottom border", () => {
    const out = strip("draft");
    expect(out).toContain(P14_COPY.STRIP_DRAFT);
    expect(out).not.toContain(P14_COPY.STRIP);
    expect(out).toContain("bg-hub-warning-tint");
    expect(out).toContain("border-hub-warning");
  });

  it("expired: its own long and short words on the ink strip", () => {
    const out = strip("expired");
    expect(out).toContain(P14_COPY.STRIP_EXPIRED);
    expect(out).toContain(STRIP_EXPIRED_SHORT);
    expect(out).toContain("bg-hub-ink");
  });
});

describe("tenant layout mounts the strip on preview hosts only (DOM-09)", () => {
  beforeEach(() => {
    state.header = HOST;
    state.path = null;
    state.cookies = {};
    for (const f of Object.values(db)) f.mockReset();
    db.readSiteManifest.mockResolvedValue(null);
    db.readPublicSiteSettings.mockResolvedValue({ banner: null });
    db.readPublicDesign.mockResolvedValue(null);
    db.readAddonSiteState.mockResolvedValue({ active: [], hiddenPageIds: [] });
    db.readPublicAddonRecords.mockResolvedValue([]);
    db.readPublicBusiness.mockResolvedValue(null);
    db.readPublicLogoId.mockResolvedValue(null);
    db.resolvePublicMedia.mockResolvedValue({});
    db.readPublishedSitePolicy.mockResolvedValue(null);
    db.readPublicAnalytics.mockResolvedValue({ ga4MeasurementId: null });
    db.readPublicPopups.mockResolvedValue([]);
    db.previewPageForLink.mockResolvedValue({ status: "invalid" });
  });

  async function render(hostKind: "preview" | "custom" | "redirect") {
    db.siteContextForHost.mockResolvedValue({
      orgId: ORG,
      host: HOST,
      hostKind,
    });
    return renderToStaticMarkup(
      (await TenantLayout({
        children: <p>child</p>,
        params: Promise.resolve({ host: HOST }),
      })) as ReactElement,
    );
  }

  it("preview host: strip first, before the themed root", async () => {
    const out = await render("preview");
    expect(out.startsWith('<aside aria-label="Preview notice"')).toBe(true);
    expect(out.indexOf("Preview notice")).toBeLessThan(
      out.indexOf("data-site"),
    );
    expect(out).toContain(P14_COPY.STRIP);
    expect(out).toContain("<p>child</p>");
  });

  it("custom host: no strip", async () => {
    const out = await render("custom");
    expect(out).not.toContain("Preview notice");
    expect(out).not.toContain(P14_COPY.STRIP);
  });

  it("redirect host: no strip", async () => {
    const out = await render("redirect");
    expect(out).not.toContain("Preview notice");
  });

  const MANIFEST = {
    version: 1,
    pages: {
      about: { id: PAGE, title: "About", published_at: "", protected: false },
      menu: {
        id: OTHER_PAGE,
        title: "Menu",
        published_at: "",
        protected: false,
      },
    },
    redirects: {},
    updated_at: "",
  };
  const DRAFT = { status: "draft", page: { page: { slug: "about" } } };

  it("valid org-matched cds_pv cookie on the page it names: draft variant", async () => {
    state.cookies.cds_pv = signPreviewToken(ORG, PAGE);
    state.path = "/about";
    db.readSiteManifest.mockResolvedValue(MANIFEST);
    db.previewPageForLink.mockResolvedValue(DRAFT);
    const out = await render("preview");
    expect(out).toContain('data-preview-strip="draft"');
    expect(out).toContain(P14_COPY.STRIP_DRAFT);
  });

  it("WR-D01: a valid link on another page, or a failed draft read, reads normal", async () => {
    state.cookies.cds_pv = signPreviewToken(ORG, PAGE);
    db.readSiteManifest.mockResolvedValue(MANIFEST);
    db.previewPageForLink.mockResolvedValue(DRAFT);
    state.path = "/menu";
    let out = await render("preview");
    expect(out).toContain('data-preview-strip="normal"');
    expect(out).not.toContain(P14_COPY.STRIP_DRAFT);
    state.path = "/about";
    db.previewPageForLink.mockRejectedValue(new Error("pb down"));
    out = await render("preview");
    expect(out).toContain('data-preview-strip="normal"');
    expect(out).not.toContain(P14_COPY.STRIP_DRAFT);
  });

  it("expired, forged or other-org cds_pv cookie: expired variant", async () => {
    for (const token of [
      signPreviewToken(ORG, PAGE, Date.now() - 2 * 60 * 60 * 1000),
      "junk",
      signPreviewToken(OTHER, PAGE),
    ]) {
      state.cookies.cds_pv = token;
      const out = await render("preview");
      expect(out).toContain('data-preview-strip="expired"');
      expect(out).toContain(P14_COPY.STRIP_EXPIRED);
    }
  });

  it("a cds_pv cookie never puts a strip on a custom host", async () => {
    state.cookies.cds_pv = signPreviewToken(ORG, PAGE);
    const out = await render("custom");
    expect(out).not.toContain("Preview notice");
  });
});
