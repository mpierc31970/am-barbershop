// index.json builder (07-31 choices 1-8; CONT-37, CONT-13, CONT-15, CONT-28; D277, D187,
// D253, D275; Pitfall 13; invariant 1). Internal, by path; never in the barrel.
//
// refreshSiteIndex(orgId, deps) rebuilds tenants/<org>/published/index.json from:
//   - the published manifest (what is live) and the live `pages` rows (id, slug, kind,
//     status); "protected" is read from the live row with one bound-param query
//     (password_protected = true || password_hash != ''), fields "id" only, so the hash is
//     never loaded and a password set without a republish still excludes the page
//   - the add-on site state (pages of disabled add-ons are hidden)
//   - the org name and the site settings row (language, AI toggle)
//   - published services and active add-ons' publicIndex hooks (registry only, invariant 4)
// The core builder applies the ONE rule (isIndexablePage) before any text is copied.
// Page text is carried over from the previous index when the manifest's published_at is
// unchanged (choice 7), so a rebuild re-reads only changed pages.
// It takes its own lock key `site-index:<org>` (choice 6): safe inside or outside the org
// lock, and rebuilds of one org never interleave. It never throws (choice 8): an error logs
// "[site-index] rebuild failed" without ids, and the last good file keeps serving.
// No soft-delete filter anywhere: a page using a deleted form, pop-up or photo stays indexed
// (07-28 relay, D275).
import type { AddonRegistry } from "@cds/core/addons";
import {
  composeSectionRegistry,
  CORE_SECTIONS,
  htmlToPlainText,
  resolveSiteSettings,
  type PublishedPage,
  type SectionRegistry,
} from "@cds/core/content";
import {
  buildSiteIndex,
  isIndexablePage,
  parseSiteIndex,
  sanitizeIndexRecords,
  suggestDescription,
  type PageIndexCandidate,
  type SiteIndex,
  type SiteIndexRecord,
} from "@cds/core/seo";
import type PocketBase from "pocketbase";
import {
  addonSiteStateIn,
  publicAddonRecordsIn,
} from "../../addons/site-state";
import { withSuperuser } from "../../client";
import { assertId } from "../../repository";
import {
  getObjectStore,
  tenantPublishedPageKey,
  tenantSiteIndexKey,
  type ObjectStore,
} from "../../storage";
import { withOrgLock } from "../lock";
import { readJson, readManifest } from "../manifest";
import { publicServicesIn, type PublicService } from "../seo/public-records";

export type SiteIndexDeps = {
  sections?: SectionRegistry;
  addons?: Pick<AddonRegistry, "list">;
  store?: ObjectStore;
  now?: () => Date;
  /**
   * 14-21 (choice 4): a site-wide live-data change at this ISO time (afterLiveSave passes
   * now). Stored in the header as `live_changed_at`; later rebuilds keep the previous one.
   */
  liveChangedAt?: string;
};

const JSON_TYPE = "application/json";

/** The later of two ISO times ("" ignored). */
function maxIso(a: string, b: string): string {
  if (a === "") return b;
  if (b === "") return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return tb > ta ? b : a;
}

let coreOnly: SectionRegistry | null = null;
function coreRegistry(): SectionRegistry {
  coreOnly ??= composeSectionRegistry(CORE_SECTIONS, []);
  return coreOnly;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Plain text of a published page's visible sections (registry textsOf, html cleaned). */
function pageText(published: PublishedPage, registry: SectionRegistry): string {
  const out: string[] = [];
  for (const s of Array.isArray(published.sections) ? published.sections : []) {
    const def = registry.get(s?.section_type);
    if (!def) continue;
    let texts: string[] = [];
    try {
      texts = def.textsOf(s.content);
    } catch {
      texts = [];
    }
    for (const t of texts) {
      if (typeof t !== "string" || t === "") continue;
      out.push(t.includes("<") ? htmlToPlainText(t) : t);
    }
  }
  return out.join(" ");
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** "Fixed" / "Starting at" / "Free" / "Ask" as the visitor reads them. */
function priceText(s: PublicService): string {
  const c = s.price_cents;
  if (s.price_display === "free") return "Free";
  if (c === null || c < 0) return "";
  if (s.price_display === "fixed") return dollars(c);
  if (s.price_display === "from") return `From ${dollars(c)}`;
  return "";
}

function serviceText(s: PublicService): string {
  const parts = [s.description, priceText(s)];
  if (s.duration_minutes !== null && s.duration_minutes > 0) {
    parts.push(`${s.duration_minutes} min`);
  }
  return parts.filter((p) => p !== "").join(" · ");
}

async function protectedIds(
  pb: PocketBase,
  orgId: string,
): Promise<Set<string>> {
  const rows = await pb.collection("pages").getFullList({
    filter: pb.filter(
      "organization = {:org} && (password_protected = true || password_hash != '')",
      { org: orgId },
    ),
    fields: "id",
  });
  return new Set(rows.map((r) => r.id));
}

async function orgName(pb: PocketBase, orgId: string): Promise<string> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "name" });
  return str((org as Record<string, unknown>).name);
}

async function siteSettings(
  pb: PocketBase,
  orgId: string,
): Promise<{ language: string; allowAiCrawlers: boolean }> {
  const res = await pb.collection("site_settings").getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    fields: "language,settings,seo",
  });
  const row = (res.items[0] ?? {}) as Record<string, unknown>;
  const group = resolveSiteSettings({
    language: row.language,
    settings: row.settings,
    seo: row.seo,
  });
  return { language: group.language, allowAiCrawlers: group.allow_ai_crawlers };
}

async function addonRecords(
  pb: PocketBase,
  orgId: string,
  active: readonly string[],
  addons: Pick<AddonRegistry, "list"> | undefined,
): Promise<SiteIndexRecord[]> {
  if (!addons) return [];
  const out: SiteIndexRecord[] = [];
  for (const m of addons.list()) {
    if (!active.includes(m.slug) || typeof m.publicIndex !== "function") {
      continue;
    }
    try {
      const records: Record<string, Record<string, unknown>[]> = {};
      for (const collection of Object.keys(m.records ?? {})) {
        records[collection] = await publicAddonRecordsIn(
          pb,
          orgId,
          m.slug,
          collection,
        );
      }
      out.push(
        ...sanitizeIndexRecords(m.publicIndex({ records }), {
          kind: m.name,
          group: m.name,
        }),
      );
    } catch {
      console.error("[site-index] add-on hook failed");
    }
  }
  return out;
}

async function rebuildIn(
  pb: PocketBase,
  orgId: string,
  deps: SiteIndexDeps,
): Promise<void> {
  const store = deps.store ?? getObjectStore();
  const now = (deps.now ?? (() => new Date()))();
  const key = tenantSiteIndexKey(orgId);
  const manifest = await readManifest(store, orgId, now);
  const previous = parseSiteIndex(await readJson(store, key));
  const prevById = new Map((previous?.pages ?? []).map((p) => [p.id, p]));
  // 14-21 (choice 4): every page's lastmod = max(published_at, live_changed_at); the header
  // value persists across rebuilds that carry no live change.
  const prevLive = previous?.live_changed_at ?? "";
  const liveChangedAt = maxIso(prevLive, deps.liveChangedAt ?? "");
  const lastmodOf = (publishedAt: string) => maxIso(publishedAt, liveChangedAt);

  // 11-29: a deleted page has no row here, so a stale manifest entry is never indexed.
  const rows = await pb.collection("pages").getFullList({
    filter: pb.filter("organization = {:org} && deleted_at = ''", {
      org: orgId,
    }),
    fields: "id,slug,kind,status",
  });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const locked = await protectedIds(pb, orgId);
  const state = await addonSiteStateIn(pb, orgId);
  const hidden = new Set(state.hiddenPageIds);
  const name = await orgName(pb, orgId);
  const settings = await siteSettings(pb, orgId);

  const registry = deps.sections ?? coreRegistry();
  let fellBack = false;

  const candidates: PageIndexCandidate[] = [];
  for (const [slug, entry] of Object.entries(manifest.pages)) {
    const row = rowById.get(entry.id);
    const base = {
      id: entry.id,
      slug,
      kind: str(row?.kind) || "builder",
      inManifest: true,
      hasRow: row !== undefined,
      protected: locked.has(entry.id) || entry.protected === true,
      held: row?.status === "held",
      addonHidden: hidden.has(entry.id),
    };
    const excluded = !isIndexablePage(base);
    if (excluded) {
      // Never read: the rule drops it anyway, so its title and text are never loaded.
      candidates.push({
        ...base,
        title: "",
        seoTitle: "",
        description: "",
        text: "",
        lastmod: lastmodOf(entry.published_at),
      });
      continue;
    }
    const prev = prevById.get(entry.id);
    // Text carry-over: the previous lastmod was max(published_at, prevLive), so an unchanged
    // published_at gives the same value (a new publish is later than any earlier live change).
    if (
      prev &&
      (prev.lastmod === maxIso(entry.published_at, prevLive) ||
        deps.sections === undefined)
    ) {
      candidates.push({
        ...base,
        title: prev.title,
        seoTitle: "",
        description: prev.description,
        text: prev.text,
        lastmod: lastmodOf(entry.published_at),
      });
      continue;
    }
    if (!deps.sections) fellBack = true;
    const raw = await readJson(store, tenantPublishedPageKey(orgId, entry.id));
    const published =
      typeof raw === "object" && raw !== null ? (raw as PublishedPage) : null;
    const seo = published?.page?.seo ?? {};
    const sections = Array.isArray(published?.sections)
      ? published!.sections
      : [];
    let description = str(seo.meta_description).trim();
    if (description === "") {
      try {
        description = suggestDescription(sections);
      } catch {
        description = "";
      }
    }
    candidates.push({
      ...base,
      title: str(published?.page?.title) || entry.title,
      seoTitle: str(seo.meta_title),
      description,
      text: published ? pageText(published, registry) : "",
      lastmod: lastmodOf(entry.published_at),
    });
  }

  // Core blocks only (add-on block text waits for the next registry-backed rebuild).
  if (fellBack) console.error("[site-index] no registry");

  // Services point at the Services page when it is indexable, else home (else dropped by
  // the core builder, which keeps records only on indexable paths).
  const services = await publicServicesIn(pb, orgId);
  const servicesPage = candidates.find(
    (c) =>
      c.slug === "services" &&
      c.hasRow &&
      !c.protected &&
      !c.held &&
      !c.addonHidden,
  );
  const servicePath = servicesPage ? "/services" : "/";
  const records: SiteIndexRecord[] = services
    .filter((s) => s.name !== "")
    .map((s) => ({
      kind: "Service",
      group: "Services",
      title: s.name,
      text: serviceText(s),
      path: servicePath,
    }));
  records.push(...(await addonRecords(pb, orgId, state.active, deps.addons)));

  const index: SiteIndex = buildSiteIndex({
    builtAt: now.toISOString(),
    liveChangedAt,
    site: {
      name,
      language: settings.language,
      allowAiCrawlers: settings.allowAiCrawlers,
    },
    candidates,
    records,
  });
  await store.put(key, JSON.stringify(index), JSON_TYPE);
}

/**
 * Rebuild the org's index.json. Never throws: false on any error (logged without ids).
 * Internal (by path from content/site-index/build); never exported from a barrel.
 */
export async function refreshSiteIndex(
  orgId: string,
  deps: SiteIndexDeps = {},
): Promise<boolean> {
  try {
    assertId(orgId);
    await withOrgLock(`site-index:${orgId}`, () =>
      withSuperuser((pb) => rebuildIn(pb, orgId, deps)),
    );
    return true;
  } catch (err) {
    console.error(
      "[site-index] rebuild failed",
      err instanceof Error ? err.name : "error",
    );
    return false;
  }
}
