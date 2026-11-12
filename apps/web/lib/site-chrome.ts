// Tenant site chrome data: header menu, logo and footer (CONT-13; D249, D253; 07-25 choices
// 7, 8). Server-only.
//
// loadSiteChrome reuses the layout's live settings and manifest, then reads the business
// profile, the hidden add-on pages and the logo, each in its own try/catch: any one failing
// still returns usable chrome (logo failure -> wordmark; business failure -> the host as the
// name, no address/hours/socials). Media URLs are resolved per call and never cached.
// 09-22 (AGR-08; choice 2): policyLinks comes from policyLinksFor, the same cached read as the
// /privacy and /terms routes, so a link never points at a 404; any failure hides both links,
// and fallbackChrome sets none (fail closed).
import {
  resolveFooter,
  resolveNav,
  type FooterBusinessInput,
  type NavPageInfo,
  type ResolvedFooter,
  type ResolvedNav,
  type SiteManifest,
} from "@cds/core/content";
import { resolvePublicMedia, type SiteContext } from "@cds/db";
import type { ResolvedMedia } from "@cds/ui/site";
import {
  getAddonSiteState,
  getPublicBusiness,
  getSiteLogoId,
  type LiveSite,
} from "./site-cache";
import { policyLinksFor, type PolicyLinks } from "./site-policy-pages";

const NO_POLICY_LINKS: PolicyLinks = { privacy: false, terms: false };

export type SiteChrome = {
  header: {
    brand: { name: string; logo: ResolvedMedia | null };
    nav: ResolvedNav;
  };
  footer: ResolvedFooter;
  /** 09-22: published tenant policy pages (footer Privacy · Terms). */
  policyLinks: PolicyLinks;
};

/** Same rule as the tenant page route: "home" is "/", any other slug "/<slug>". */
export function manifestPages(
  manifest: SiteManifest | null,
): Map<string, NavPageInfo> {
  const out = new Map<string, NavPageInfo>();
  if (!manifest) return out;
  for (const [slug, entry] of Object.entries(manifest.pages ?? {})) {
    if (!entry || typeof entry.id !== "string") continue;
    out.set(entry.id, {
      path: slug === "home" ? "/" : `/${encodeURIComponent(slug)}`,
      title: typeof entry.title === "string" ? entry.title : slug,
    });
  }
  return out;
}

function emptyBusiness(name: string): FooterBusinessInput {
  return {
    name,
    phone: "",
    public_email: "",
    address: null,
    time_zone: "",
    hours: null,
    socials: [],
  };
}

/** Header and footer render data for one tenant request. */
export async function loadSiteChrome(
  site: SiteContext,
  input: { live: LiveSite; manifest: SiteManifest | null; now: Date },
): Promise<SiteChrome> {
  const pages = manifestPages(input.manifest);
  const [business, hidden, logo, policyLinks] = await Promise.all([
    getPublicBusiness(site).catch(() => {
      console.error("[site] chrome business failed");
      return null;
    }),
    getAddonSiteState(site)
      .then((s) => s?.hiddenPageIds ?? [])
      .catch(() => {
        console.error("[site] chrome addons failed");
        return [] as string[];
      }),
    (async (): Promise<ResolvedMedia | null> => {
      try {
        const id = await getSiteLogoId(site);
        if (!id) return null;
        const media = await resolvePublicMedia(site, [id], { pageId: "site" });
        const m = Object.hasOwn(media, id) ? media[id] : undefined;
        return m && m.kind === "image" && m.src !== "" ? m : null;
      } catch {
        console.error("[site] chrome logo failed");
        return null;
      }
    })(),
    policyLinksFor(site).catch(() => {
      console.error("[site] chrome policy links failed");
      return NO_POLICY_LINKS;
    }),
  ]);
  const name = business?.name?.trim() ? business.name.trim() : site.host;
  const biz: FooterBusinessInput = business
    ? { ...business, name }
    : emptyBusiness(name);
  const hiddenPageIds = new Set(hidden);
  return {
    header: {
      brand: { name, logo },
      nav: resolveNav(input.live.nav, { pages, hiddenPageIds }),
    },
    footer: resolveFooter(input.live.footer, {
      business: biz,
      pages,
      hiddenPageIds,
      year: input.now.getUTCFullYear(),
    }),
    policyLinks,
  };
}

/** The never-fail fallback: host wordmark, empty menu, bottom row only. */
export function fallbackChrome(host: string, now: Date): SiteChrome {
  return {
    header: {
      brand: { name: host, logo: null },
      nav: { entries: [], cta: null },
    },
    footer: resolveFooter(
      {
        show_address: false,
        show_hours: false,
        show_socials: false,
        extra_links: [],
        copyright: "",
        held: false,
      },
      {
        business: emptyBusiness(""),
        pages: new Map(),
        year: now.getUTCFullYear(),
      },
    ),
    policyLinks: NO_POLICY_LINKS,
  };
}

/**
 * Popular pages (07-31; CONT-28): the live menu's top-level links to this site's own pages,
 * in menu order (a dropdown contributes its first page). Used under SEARCH-NONE on /search;
 * 07-32's 404 reuses it. Never throws: any failed read returns [].
 */
export async function popularPages(
  site: SiteContext,
  input: { live: LiveSite; manifest: SiteManifest | null },
): Promise<{ label: string; href: string }[]> {
  try {
    const hidden = await getAddonSiteState(site)
      .then((s) => s?.hiddenPageIds ?? [])
      .catch(() => [] as string[]);
    const nav = resolveNav(input.live.nav, {
      pages: manifestPages(input.manifest),
      hiddenPageIds: new Set(hidden),
    });
    const out: { label: string; href: string }[] = [];
    for (const e of nav.entries) {
      const link = e.kind === "link" ? e : e.links[0];
      if (link && link.href.startsWith("/") && !link.href.startsWith("//")) {
        out.push({
          label: e.kind === "link" ? e.label : link.label,
          href: link.href,
        });
      }
    }
    return out.slice(0, 8);
  } catch {
    console.error("[site] popular pages failed");
    return [];
  }
}
