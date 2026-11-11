// Canonical URL, robots and page metadata as plain data (07-30 choices 1, 2, 13; CONT-13,
// CONT-14; D170, D188; Pitfall 9; T-07-30-03, T-07-30-11).
//
// The origin always comes from org_hosts (the primary host, else the resolved tenant host),
// never from the request Host header. Canonical drops every query string (?g<id>= gallery
// pages, form status, tracking). Preview hosts are noindex,nofollow (D170); system pages
// (NOINDEX_PAGE_KINDS) and password-protected pages are noindex,follow. The route maps
// pageMeta(...) to Next Metadata; nothing here imports next.
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import type { PageSeo } from "../../content/types";
import { suggestDescription, suggestTitle } from "./suggest";

// 14-14 (P14-P5): `redirect` rows 301 in middleware and never render; only `custom` indexes.
export type HostKind = "preview" | "custom" | "redirect";

/** Page kinds that never appear in search; 07-31's index and 07-32's 404 read this. */
export const NOINDEX_PAGE_KINDS: readonly string[] = Object.freeze([
  "system-404",
]);

/** The public path of a slug: home is "/", else "/<encoded slug>" (the tenant route's rule). */
export function slugPathFor(slug: string): string {
  return slug === "home" ? "/" : `/${encodeURIComponent(slug)}`;
}

const HOST_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

function cleanHost(host: unknown): string | null {
  if (typeof host !== "string") return null;
  const h = host.trim().toLowerCase();
  return h !== "" && HOST_RE.test(h) ? h : null;
}

/** `https://<host>` for the primary host, else the fallback (a resolved org_hosts row). */
export function canonicalOrigin(input: {
  primaryHost: string | null | undefined;
  fallbackHost: string;
}): string {
  const host =
    cleanHost(input.primaryHost) ??
    cleanHost(input.fallbackHost) ??
    "localhost";
  return `https://${host}`;
}

/** https://<primary host>/<slug>; home is "/", query strings never included. */
export function canonicalUrl(input: {
  primaryHost: string | null | undefined;
  fallbackHost: string;
  slug: string;
}): string {
  return `${canonicalOrigin(input)}${slugPathFor(input.slug)}`;
}

export type RobotsData = { index: boolean; follow: boolean };

export function robotsFor(input: {
  hostKind: HostKind | string;
  pageKind?: string;
  protectedPage?: boolean;
}): RobotsData {
  if (input.hostKind !== "custom") return { index: false, follow: false };
  if (
    input.protectedPage === true ||
    (typeof input.pageKind === "string" &&
      NOINDEX_PAGE_KINDS.includes(input.pageKind))
  ) {
    return { index: false, follow: true };
  }
  return { index: true, follow: true };
}

/**
 * A `/`-relative or http(s) src made absolute against origin; anything else -> null.
 * `//host` and `/\host` are refused: URL parsing reads both as another host.
 */
export function absoluteUrl(origin: string, src: unknown): string | null {
  if (typeof src !== "string") return null;
  const s = src.trim();
  if (s === "") return null;
  if (s.startsWith("/")) {
    if (s[1] === "/" || s[1] === "\\") return null;
    try {
      return new URL(s, origin).href;
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export type MetaImageSource = {
  src: string;
  width?: number;
  height?: number;
  alt?: string;
};

export type MetaImage = {
  url: string;
  width?: number;
  height?: number;
  alt: string;
};

export type PageMetaInput = {
  primaryHost: string | null | undefined;
  fallbackHost: string;
  hostKind: HostKind | string;
  pageKind?: string;
  protectedPage?: boolean;
  slug: string;
  isHome: boolean;
  pageTitle: string;
  seo: PageSeo | null | undefined;
  businessName: string;
  sections: readonly unknown[];
  /** The page's chosen library photo (resolved), if any. */
  pageImage?: MetaImageSource | null;
  /** The site's chosen share photo (resolved), if any. */
  siteImage?: MetaImageSource | null;
  /** The generated 1200x630 share image (`/_site/share.png?v=`), if generated. */
  generatedImage?: string | null;
};

export type PageMeta = {
  title: string;
  description: string;
  canonical: string;
  robots: RobotsData;
  image: MetaImage | null;
  openGraph: {
    type: "website";
    url: string;
    title: string;
    description: string;
    siteName: string;
    images: MetaImage[];
  };
  twitter: {
    card: "summary_large_image" | "summary";
    title: string;
    description: string;
    images: string[];
  };
};

function pick(
  origin: string,
  source: MetaImageSource | null | undefined,
  fallbackAlt: string,
): MetaImage | null {
  if (!source) return null;
  const url = absoluteUrl(origin, source.src);
  if (!url) return null;
  const img: MetaImage = { url, alt: source.alt?.trim() || fallbackAlt };
  if (typeof source.width === "number" && source.width > 0)
    img.width = source.width;
  if (typeof source.height === "number" && source.height > 0)
    img.height = source.height;
  return img;
}

/** The share image chain: page photo -> page link -> site photo -> generated image. */
function shareImage(
  input: PageMetaInput,
  origin: string,
  alt: string,
): MetaImage | null {
  return (
    pick(origin, input.pageImage, alt) ??
    pick(
      origin,
      input.seo?.og_image ? { src: input.seo.og_image } : null,
      alt,
    ) ??
    pick(origin, input.siteImage, alt) ??
    pick(
      origin,
      input.generatedImage
        ? { src: input.generatedImage, width: 1200, height: 630 }
        : null,
      alt,
    )
  );
}

/**
 * Title, description, canonical, robots, Open Graph and Twitter data for one page.
 * A protected page (07-32 choice 7) gets no description and no share image, whatever
 * the caller passes, so private content never reaches public meta tags.
 */
export function pageMeta(input: PageMetaInput): PageMeta {
  const locked = input.protectedPage === true;
  const origin = canonicalOrigin(input);
  const canonical = `${origin}${slugPathFor(input.slug)}`;
  const seo = input.seo ?? {};
  const title =
    seo.meta_title?.trim() ||
    suggestTitle(input.pageTitle, input.businessName, {
      isHome: input.isHome,
    }) ||
    input.pageTitle.trim();
  let description = locked ? "" : seo.meta_description?.trim() || "";
  if (!locked && description === "") {
    try {
      description = suggestDescription(input.sections);
    } catch {
      description = "";
    }
  }
  const image = locked ? null : shareImage(input, origin, title);
  return {
    title,
    description,
    canonical,
    robots: robotsFor(input),
    image,
    openGraph: {
      type: "website",
      url: canonical,
      title,
      description,
      siteName: input.businessName.trim(),
      images: image ? [image] : [],
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image.url] : [],
    },
  };
}
