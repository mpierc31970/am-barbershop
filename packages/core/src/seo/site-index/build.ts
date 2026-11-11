// Site index builder (07-31 choices 2, 3, 4, 7; CONT-37, D277, D187; Pitfall 13).
// buildSiteIndex filters candidates with the one rule (isIndexablePage) BEFORE any text is
// copied, so an excluded page's title, text and slug never reach index.json. Records survive
// only when their path is an indexable page. parseSiteIndex is deny by default.
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.
import { slugPathFor } from "../page/meta";
import { isIndexablePage, recordTargetsIndexablePage } from "./rule";
import {
  SITE_INDEX_VERSION,
  type SiteIndex,
  type SiteIndexInput,
  type SiteIndexPage,
  type SiteIndexRecord,
} from "./types";

export const SITE_INDEX_LIMITS = Object.freeze({
  pages: 500,
  records: 1000,
  recordText: 2000,
  totalTextChars: 1_200_000,
  pageTextMax: 20_000,
  recordsPerAddon: 200,
  kind: 40,
  group: 40,
  title: 200,
  description: 500,
  name: 200,
  language: 35,
});

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Collapse whitespace and cut at a word boundary to at most `max` chars. */
export function cutText(text: string, max: number): string {
  const t = str(text).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const at = head.lastIndexOf(" ");
  return (at > 0 ? head.slice(0, at) : t.slice(0, max)).trimEnd();
}

export function buildSiteIndex(input: SiteIndexInput): SiteIndex {
  const kept = input.candidates.filter((c) => isIndexablePage(c));
  const capped = kept.slice(0, SITE_INDEX_LIMITS.pages);
  const perPage = Math.min(
    SITE_INDEX_LIMITS.pageTextMax,
    Math.floor(SITE_INDEX_LIMITS.totalTextChars / Math.max(1, capped.length)),
  );
  const seen = new Set<string>();
  const pages: SiteIndexPage[] = [];
  let summary = "";
  for (const c of capped) {
    const path = slugPathFor(str(c.slug));
    if (seen.has(path)) continue;
    seen.add(path);
    const title = cutText(
      str(c.seoTitle).trim() || str(c.title),
      SITE_INDEX_LIMITS.title,
    );
    const description = cutText(
      str(c.description),
      SITE_INDEX_LIMITS.description,
    );
    pages.push({
      id: str(c.id),
      path,
      title,
      description,
      text: cutText(str(c.text), perPage),
      lastmod: str(c.lastmod),
    });
    if (path === "/") summary = description;
  }
  const records: SiteIndexRecord[] = [];
  for (const r of input.records) {
    if (records.length >= SITE_INDEX_LIMITS.records) break;
    if (!recordTargetsIndexablePage(r.path, seen)) continue;
    const rec: SiteIndexRecord = {
      kind: cutText(r.kind, SITE_INDEX_LIMITS.kind),
      group: cutText(r.group, SITE_INDEX_LIMITS.group),
      title: cutText(r.title, SITE_INDEX_LIMITS.title),
      text: cutText(r.text, SITE_INDEX_LIMITS.recordText),
      path: r.path,
    };
    if (typeof r.lastmod === "string" && r.lastmod !== "") {
      rec.lastmod = r.lastmod;
    }
    records.push(rec);
  }
  const liveChangedAt = str(input.liveChangedAt);
  return {
    v: SITE_INDEX_VERSION,
    built_at: str(input.builtAt),
    ...(liveChangedAt !== "" ? { live_changed_at: liveChangedAt } : {}),
    site: {
      name: cutText(str(input.site.name), SITE_INDEX_LIMITS.name),
      summary,
      language:
        cutText(str(input.site.language), SITE_INDEX_LIMITS.language) || "en",
      allow_ai_crawlers: input.site.allowAiCrawlers !== false,
    },
    pages,
    records,
  };
}

const FRAGMENT_RE = /^[a-z0-9-]+$/;

/** A site-relative path: "/", "/x", "/x/y", optional "#frag"; no scheme, query, "..", "//". */
export function safeIndexPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > 300) return null;
  const hash = raw.indexOf("#");
  const path = hash === -1 ? raw : raw.slice(0, hash);
  const frag = hash === -1 ? null : raw.slice(hash + 1);
  if (frag !== null && !FRAGMENT_RE.test(frag)) return null;
  if (!path.startsWith("/")) return null;
  if (path.includes("//") || path.includes("..")) return null;
  if (/[\s?\\]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (path.includes(":")) return null;
  return raw;
}

function safeGet(obj: object, key: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(obj, key)
      ? (obj as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

/** Add-on hook output -> records; never throws, at most 200 kept, deny by default. */
export function sanitizeIndexRecords(
  raw: unknown,
  defaults: { kind: string; group: string },
): SiteIndexRecord[] {
  const out: SiteIndexRecord[] = [];
  let arr: unknown[];
  try {
    if (!Array.isArray(raw)) return out;
    arr = raw.slice(0, SITE_INDEX_LIMITS.recordsPerAddon * 5);
  } catch {
    return out;
  }
  for (const item of arr) {
    if (out.length >= SITE_INDEX_LIMITS.recordsPerAddon) break;
    try {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const title = cutText(
        str(safeGet(item, "title")),
        SITE_INDEX_LIMITS.title,
      );
      if (title === "") continue;
      const path = safeIndexPath(safeGet(item, "path"));
      if (path === null) continue;
      const kind =
        cutText(str(safeGet(item, "kind")), SITE_INDEX_LIMITS.kind) ||
        cutText(defaults.kind, SITE_INDEX_LIMITS.kind);
      const group =
        cutText(str(safeGet(item, "group")), SITE_INDEX_LIMITS.group) ||
        cutText(defaults.group, SITE_INDEX_LIMITS.group);
      const rec: SiteIndexRecord = {
        kind,
        group,
        title,
        text: cutText(str(safeGet(item, "text")), SITE_INDEX_LIMITS.recordText),
        path,
      };
      const lastmod = str(safeGet(item, "lastmod"));
      if (lastmod !== "" && lastmod.length <= 40) rec.lastmod = lastmod;
      out.push(rec);
    } catch {
      // hostile item: skip
    }
  }
  return out;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** index.json -> SiteIndex, or null for anything malformed / another version. */
export function parseSiteIndex(raw: unknown): SiteIndex | null {
  try {
    if (!isObj(raw) || raw.v !== SITE_INDEX_VERSION) return null;
    const site = raw.site;
    if (!isObj(site)) return null;
    if (
      typeof site.name !== "string" ||
      typeof site.summary !== "string" ||
      typeof site.language !== "string" ||
      typeof site.allow_ai_crawlers !== "boolean"
    ) {
      return null;
    }
    if (typeof raw.built_at !== "string") return null;
    if (!Array.isArray(raw.pages) || !Array.isArray(raw.records)) return null;
    const pages: SiteIndexPage[] = [];
    for (const p of raw.pages) {
      if (!isObj(p)) return null;
      const { id, path, title, description, text, lastmod } = p;
      if (
        typeof id !== "string" ||
        typeof path !== "string" ||
        typeof title !== "string" ||
        typeof description !== "string" ||
        typeof text !== "string" ||
        typeof lastmod !== "string" ||
        safeIndexPath(path) === null
      ) {
        return null;
      }
      pages.push({ id, path, title, description, text, lastmod });
    }
    const records: SiteIndexRecord[] = [];
    for (const r of raw.records) {
      if (!isObj(r)) return null;
      const { kind, group, title, text, path, lastmod } = r;
      if (
        typeof kind !== "string" ||
        typeof group !== "string" ||
        typeof title !== "string" ||
        typeof text !== "string" ||
        typeof path !== "string" ||
        safeIndexPath(path) === null
      ) {
        return null;
      }
      const rec: SiteIndexRecord = { kind, group, title, text, path };
      if (typeof lastmod === "string") rec.lastmod = lastmod;
      records.push(rec);
    }
    return {
      v: SITE_INDEX_VERSION,
      built_at: raw.built_at,
      ...(typeof raw.live_changed_at === "string" && raw.live_changed_at !== ""
        ? { live_changed_at: raw.live_changed_at }
        : {}),
      site: {
        name: site.name,
        summary: site.summary,
        language: site.language,
        allow_ai_crawlers: site.allow_ai_crawlers,
      },
      pages,
      records,
    };
  } catch {
    return null;
  }
}
