// Read-only visitor context (invariant 1, D187, D253; CONTEXT A3-Q1; T-03-32, T-03-36).
//
// Anonymous visitors of a tenant site never hold an OrgContext. They get a SiteContext,
// minted only here from a resolved hostname (resolveOrganization: active orgs only, cached
// 30 s / 5 s). A module-private WeakSet brands it like context.ts, and the minter is never
// exported from index.ts, so a plain { orgId, host } object is refused (InvalidContext).
//
// What a SiteContext can read, and nothing else:
//   - the published manifest and published page JSON from the object store (never the
//     draft rows). A page id must be listed in the org's own manifest first, so no key can
//     be guessed across orgs.
//   - the registry's `public` field list of site_settings (banner, nav, footer; 07-25; settings,
//     language, seo -> the settings group, 07-26) and of enabled
//     pop-ups, copied field by field (never spread). A soft-deleted pop-up (07-28, D275) is
//     served button-only (trigger "click", show_on "button-only"); deleted_at is read for that decision, never projected
//   - the public business projection (name, business type, phone, public email, address, time
//     zone, hours, socials) for data-bound blocks (07-07) and JSON-LD (07-30); socials come
//     from social_accounts (11-35), never business_profile
//   - published services and team members (07-30, content/seo/public-records.ts)
//   - the org's GA4 measurement id only (11-32, DASH-11; re-validated, never the property id,
//     Search Console site or owner), for the consent-gated GA4 loader
// One write exists: `submitForm` in `../forms/submit.ts` (CONT-25, RESEARCH Pattern 5), audited
// as form.submitted. Nothing else writes with a SiteContext. No caller filters: every query is
// built here with bound params.
import { InvalidContext } from "@cds/core";
import {
  SOCIAL_PLATFORMS,
  validateHours,
  validateTimeZone,
  type Address,
  type SocialLink,
  type WeeklyHours,
} from "@cds/core/intake";
import {
  SITE_SETTINGS_DEFAULTS,
  resolveSiteSettings,
  validateBanner,
  validateFooter,
  validateNav,
  type SiteSettingsGroup,
  type BannerSettings,
  type FooterSettings,
  type NavSettings,
  type PopupRecord,
  type PublishedPage,
  type SiteManifest,
} from "@cds/core/content";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import {
  ORGANIZATION_PUBLIC_FIELDS,
  getCollectionSpec,
  projectPublic,
} from "../registry";
import { parseOrgAnalytics } from "../reports/analytics";
import { linksOfRows, readSocialRows } from "../social/rows";
import { resolveOrganization, type HostKind } from "../resolve";
import {
  getObjectStore,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  type ObjectStore,
} from "../storage";
import { parseManifest } from "./manifest";
import { publishedPageForPlan } from "./project";

declare const SITE: unique symbol;

export type SiteContext = Readonly<{
  orgId: string;
  host: string;
  /** 07-30: the matched host's kind (preview -> noindex, D170). */
  hostKind: HostKind;
  /** 07-30: the org's primary hostname (canonical origin), or null. */
  primaryHost: string | null;
}> & {
  readonly [SITE]: true;
};

const siteMinted = new WeakSet<object>();

/** Internal: only siteContextForHost calls this. Never exported from index.ts. */
function mintSiteContext(v: {
  orgId: string;
  host: string;
  hostKind: HostKind;
  primaryHost: string | null;
}): SiteContext {
  const ctx = Object.freeze({
    orgId: v.orgId,
    host: v.host,
    hostKind: v.hostKind,
    primaryHost: v.primaryHost,
  }) as unknown as SiteContext;
  siteMinted.add(ctx);
  return ctx;
}

export function assertSiteContext(ctx: unknown): asserts ctx is SiteContext {
  if (typeof ctx !== "object" || ctx === null || !siteMinted.has(ctx)) {
    throw new InvalidContext("site context was not minted by @cds/db");
  }
}

/** The visitor context for a tenant hostname, or null (the caller 404s). */
export async function siteContextForHost(
  host: string,
): Promise<SiteContext | null> {
  const resolved = await resolveOrganization(host);
  if (!resolved) return null;
  return mintSiteContext({
    orgId: resolved.orgId,
    host: resolved.host,
    hostKind: resolved.hostKind,
    primaryHost: resolved.primaryHost,
  });
}

async function readJson(store: ObjectStore, key: string): Promise<unknown> {
  const bytes = await store.get(key);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

/** The org's published manifest, or null when nothing is published. */
export async function readSiteManifest(
  site: SiteContext,
  store?: ObjectStore,
): Promise<SiteManifest | null> {
  assertSiteContext(site);
  const raw = await readJson(
    store ?? getObjectStore(),
    tenantSiteManifestKey(site.orgId),
  );
  if (raw === null) return null;
  return parseManifest(raw, new Date(0));
}

/** A published page of this org, or null. The id must be in the org's own manifest. */
export async function readPublishedPage(
  site: SiteContext,
  pageId: string,
  store?: ObjectStore,
): Promise<PublishedPage | null> {
  assertSiteContext(site);
  if (typeof pageId !== "string" || !/^[a-z0-9]{1,64}$/.test(pageId)) {
    return null;
  }
  const s = store ?? getObjectStore();
  const manifest = await readSiteManifest(site, s);
  if (!manifest) return null;
  const listed = Object.values(manifest.pages).some((e) => e.id === pageId);
  if (!listed) return null;
  const raw = await readJson(s, tenantPublishedPageKey(site.orgId, pageId));
  if (typeof raw !== "object" || raw === null) return null;
  // 10-42 (D233): tables follow the org's Builder Pro state; the stored JSON is untouched.
  const page = raw as PublishedPage;
  return withSuperuser((pb) => publishedPageForPlan(pb, site.orgId, page));
}

/** A row's public fields, owner-gated fields included (projectPublic, B-WR-04). */
function pick(
  collection: string,
  record: RecordModel,
): Record<string, unknown> {
  return projectPublic(getCollectionSpec(collection), record);
}

export type PublicSiteSettings = {
  banner: BannerSettings | null;
  nav: NavSettings | null;
  footer: FooterSettings | null;
  /** 07-26: language, Translate, Search and AI switches; always resolved (defaults). */
  settings: SiteSettingsGroup;
};

/** Validate one stored part; absent or malformed -> null (a bad part never hides the others). */
function part<T>(value: unknown, validate: (raw: unknown) => T): T | null {
  if (value === null || value === undefined) return null;
  try {
    return validate(value);
  } catch {
    return null;
  }
}

/**
 * The org's public site settings: banner, menu and footer (07-25), each validated on its
 * own, and the settings group (07-26: language, show_translate, show_search,
 * allow_ai_crawlers), resolved piece by piece so a malformed value falls back to its
 * default and never throws.
 */
export async function readPublicSiteSettings(
  site: SiteContext,
): Promise<PublicSiteSettings> {
  assertSiteContext(site);
  let row: RecordModel;
  try {
    row = await withSuperuser((pb) =>
      pb
        .collection("site_settings")
        .getFirstListItem(
          pb.filter("organization = {:org}", { org: site.orgId }),
        ),
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      return {
        banner: null,
        nav: null,
        footer: null,
        settings: { ...SITE_SETTINGS_DEFAULTS },
      };
    }
    throw err;
  }
  const pub = pick("site_settings", row);
  return {
    banner: part(pub.banner, validateBanner),
    nav: part(pub.nav, validateNav),
    footer: part(pub.footer, validateFooter),
    settings: resolveSiteSettings({
      language: pub.language,
      settings: pub.settings,
      seo: pub.seo,
    }),
  };
}

/** The org's enabled pop-ups, public fields only. */
export async function readPublicPopups(
  site: SiteContext,
): Promise<PopupRecord[]> {
  assertSiteContext(site);
  const rows = await withSuperuser((pb) =>
    pb.collection("popups").getFullList({
      filter: pb.filter("organization = {:org} && enabled = true", {
        org: site.orgId,
      }),
      sort: "created,id",
    }),
  );
  // Array fields are normalized on read (03-12): a row written outside savePopup (seed,
  // restore, an older shape) stores null for an unset JSON field, and the renderers spread
  // page_ids and map content.items.
  return rows.map((r) => {
    const pub = pick("popups", r);
    const content = pub.content as { items?: unknown } | null;
    const deletedAt = (r as Record<string, unknown>).deleted_at;
    const softDeleted = typeof deletedAt === "string" && deletedAt !== "";
    return {
      ...pub,
      // Button-only: rendered on every page so any button still opens it, never auto-shown.
      ...(softDeleted ? { trigger: "click", show_on: "button-only" } : {}),
      page_ids: Array.isArray(pub.page_ids)
        ? pub.page_ids.filter((v): v is string => typeof v === "string")
        : [],
      content: { items: Array.isArray(content?.items) ? content.items : [] },
      enabled: true,
    } as unknown as PopupRecord;
  });
}

// ---- Public business projection (07-07; D253, D257; T-07-07-05, T-07-07-06) ----

/** What data-bound blocks (hours, social, map) may show a visitor. Nothing else. */
export type PublicBusiness = {
  name: string;
  /** 07-30: BUSINESS_TYPES id ("" when unset); JSON-LD maps it to a schema.org type. */
  business_type: string;
  phone: string;
  public_email: string;
  address: Address;
  time_zone: string;
  hours: WeeklyHours | null;
  socials: SocialLink[];
};

const PUBLIC_SOCIALS_MAX = 12;

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function ownValue(o: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

/**
 * Visitor-safe social links (11-35: the rows of social_accounts, as SocialLink): at most 12,
 * known platforms and http(s) URLs only; an "other" link keeps its name (`label`, max 40).
 */
export function projectSocials(raw: unknown): SocialLink[] {
  if (!Array.isArray(raw)) return [];
  const platforms: readonly string[] = SOCIAL_PLATFORMS;
  const out: SocialLink[] = [];
  for (const entry of raw) {
    if (out.length >= PUBLIC_SOCIALS_MAX) break;
    if (!isPlainObject(entry)) continue;
    const platform = ownValue(entry, "platform");
    const url = ownValue(entry, "url");
    if (typeof platform !== "string" || !platforms.includes(platform)) continue;
    if (typeof url !== "string" || url.length > 2048) continue;
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    const label = ownValue(entry, "label");
    const name =
      platform === "other" && typeof label === "string"
        ? label.trim().slice(0, 40)
        : "";
    out.push(
      name
        ? {
            platform: platform as SocialLink["platform"],
            url: parsed.href,
            label: name,
          }
        : { platform: platform as SocialLink["platform"], url: parsed.href },
    );
  }
  return out;
}

/**
 * The seven public business fields, copied one by one from an already-public projection
 * (never spread). Invalid hours -> null, invalid time zone -> "", socials kept only with a
 * known platform and an http(s) url (at most 12), address parts capped at 200.
 */
export function projectPublicBusiness(
  pub: Readonly<Record<string, unknown>>,
  name: unknown,
  /** 11-35: the org's social_accounts as links; when omitted, `pub.socials` (builder preview). */
  socials?: unknown,
): PublicBusiness {
  const src = pub as Record<string, unknown>;
  const addr = ownValue(src, "address");
  const a = isPlainObject(addr) ? addr : {};
  let hours: WeeklyHours | null = null;
  const rawHours = ownValue(src, "hours");
  if (rawHours !== null && rawHours !== undefined) {
    try {
      hours = validateHours(rawHours);
    } catch {
      hours = null;
    }
  }
  let time_zone = "";
  try {
    time_zone = validateTimeZone(ownValue(src, "time_zone"));
  } catch {
    time_zone = "";
  }
  return {
    name: str(name),
    business_type: str(ownValue(src, "business_type"), 60),
    phone: str(ownValue(src, "phone")),
    public_email: str(ownValue(src, "public_email")),
    address: {
      street: str(ownValue(a, "street")),
      city: str(ownValue(a, "city")),
      state: str(ownValue(a, "state")),
      zip: str(ownValue(a, "zip")),
    },
    time_zone,
    hours,
    socials: projectSocials(
      socials !== undefined ? socials : ownValue(src, "socials"),
    ),
  };
}

/** The org's public business projection, or null when it has no business profile. */
export async function readPublicBusiness(
  site: SiteContext,
): Promise<PublicBusiness | null> {
  assertSiteContext(site);
  const result = await withSuperuser(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getOne(site.orgId, { fields: ORGANIZATION_PUBLIC_FIELDS.join(",") });
    let row: RecordModel;
    try {
      row = await pb
        .collection("business_profile")
        .getFirstListItem(
          pb.filter("organization = {:org}", { org: site.orgId }),
        );
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        return null;
      }
      throw err;
    }
    // 11-35 (DASH-14, Pitfall 3): social links come from social_accounts, the one source.
    const socials = linksOfRows(await readSocialRows(pb, site.orgId));
    return { orgName: org.name as unknown, row, socials };
  });
  if (result === null) return null;
  return projectPublicBusiness(
    pick("business_profile", result.row),
    result.orgName,
    result.socials,
  );
}

// ---- GA4 measurement id (11-32; DASH-11, CONT-34; T-11-32-03) ----

/** What the tenant page needs to load GA4 after consent. Nothing else of `analytics`. */
export type PublicAnalytics = { ga4MeasurementId: string | null };

/**
 * The site's GA4 measurement id, re-checked against the G- pattern (a malformed stored value
 * reads as null), or null when unset. Never the property id, Search Console site or owner.
 */
export async function readPublicAnalytics(
  site: SiteContext,
): Promise<PublicAnalytics> {
  assertSiteContext(site);
  const raw = await withSuperuser(async (pb) => {
    const row = await pb
      .collection("organizations")
      .getOne(site.orgId, { fields: "analytics" });
    return row.analytics as unknown;
  });
  return {
    ga4MeasurementId: parseOrgAnalytics(raw).ga4_measurement_id ?? null,
  };
}
