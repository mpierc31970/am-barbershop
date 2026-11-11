// The one reference finder for D275 (07-12; CONT-36). "Is this pop-up / form / media item
// still used?" = any page's draft rows, any page's kept versions (pages.version_refs) or any
// pop-up's items. 07-12 uses it for media delete; 07-28 reuses it for forms and pop-ups.
// Internal to @cds/db (not in the barrel). Every query is bound to the scope's org.
// 07-28: takes an OrgScope ({ orgId }; an OrgContext satisfies it, and the GC passes one per
// org); soft-deleted pop-ups count as holders (they are still served, choice 2); the draft,
// version and pop-up scanners are exported for content/soft-delete.ts (the one D275 rule).
//   - rowsRefs: union of refsOf(content) over page_sections-shaped rows (unknown types skip)
//   - popupRefs: union of itemRefs over a pop-up's `content.items`
//   - versionRefsOf: the retained versions' refs, reusing stored entries and reading a
//     version's JSON only when its entry is missing (pre-P7 pages); never throws on a
//     malformed version (it contributes nothing)
//   - ensureVersionRefs: the same, persisted on the page when anything was computed
import {
  emptyRefs,
  itemRefs,
  unionRefs,
  type ColumnItem,
  type SectionRefs,
  type SectionRegistry,
} from "@cds/core/content";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import {
  getObjectStore,
  tenantVersionPrefix,
  type ObjectStore,
} from "../storage";
import { readJson } from "./manifest";
import {
  buildVersionRefs,
  parseVersionRefs,
  VERSIONS_KEPT,
  type VersionRefs,
} from "./version-refs";

/** The org a reference scan is bound to. An OrgContext satisfies it. */
export type OrgScope = { readonly orgId: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Union of refsOf(content) over rows ({ section_type, content }); unknown types ignored. */
export function rowsRefs(
  rows: readonly unknown[],
  registry: SectionRegistry,
): SectionRefs {
  const list: SectionRefs[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isRecord(r) || typeof r.section_type !== "string") continue;
    const def = registry.get(r.section_type);
    if (!def) continue;
    try {
      list.push(def.refsOf(r.content));
    } catch {
      // A malformed row references nothing.
    }
  }
  return unionRefs(list);
}

const SHARE_ID_RE = /^[a-z0-9]{15}$/;

/** The media id in a `seo.share_image`, else "" (07-30 choice 6). */
export function shareImageOf(seo: unknown): string {
  if (!isRecord(seo)) return "";
  const v = Object.hasOwn(seo, "share_image") ? seo.share_image : undefined;
  return typeof v === "string" && SHARE_ID_RE.test(v) ? v : "";
}

/**
 * A page's share image as refs (WR-A05). A published or kept version holds the share image
 * it was published with, so deleting it in the library while the draft points elsewhere
 * never hard-deletes what the live page's og:image still serves.
 */
export function pageShareRefs(page: unknown): SectionRefs {
  const id = isRecord(page) ? shareImageOf(page.seo) : "";
  return { popups: [], forms: [], media: id ? [id] : [] };
}

/** Refs of one version JSON ({ page, sections }): its rows plus its page's share image. */
export function versionJsonRefs(
  raw: unknown,
  registry: SectionRegistry,
): SectionRefs {
  if (!isRecord(raw)) return emptyRefs();
  return unionRefs([
    rowsRefs(Array.isArray(raw.sections) ? raw.sections : [], registry),
    pageShareRefs(raw.page),
  ]);
}

/** Union of itemRefs over a pop-up's items (pop-up content is { items }). */
export function popupRefs(content: unknown): SectionRefs {
  if (!isRecord(content) || !Array.isArray(content.items)) return emptyRefs();
  return unionRefs(
    content.items
      .filter(isRecord)
      .map((item) => itemRefs(item as unknown as ColumnItem)),
  );
}

/** Retained version file names of a page, oldest first (at most VERSIONS_KEPT). */
export async function retainedVersionNames(
  store: ObjectStore,
  orgId: string,
  pageId: string,
): Promise<string[]> {
  const prefix = tenantVersionPrefix(orgId, pageId);
  return (await store.list(prefix))
    .map((o) => o.key.slice(prefix.length))
    .filter((n) => n !== "" && !n.includes("/"))
    .sort()
    .slice(-VERSIONS_KEPT);
}

/**
 * Refs for each of `names`, reusing `stored` entries and reading a version's JSON only when
 * it has none. `computed` says whether any JSON was read.
 */
export async function versionEntries(
  store: ObjectStore,
  orgId: string,
  pageId: string,
  names: readonly string[],
  stored: VersionRefs | null,
  registry: SectionRegistry,
): Promise<{ entries: Record<string, SectionRefs>; computed: boolean }> {
  const prefix = tenantVersionPrefix(orgId, pageId);
  const entries: Record<string, SectionRefs> = {};
  let computed = false;
  for (const name of names) {
    const have = stored?.versions[name];
    if (have) {
      entries[name] = have;
      continue;
    }
    computed = true;
    let refs = emptyRefs();
    try {
      const raw = await readJson(store, prefix + name);
      if (isRecord(raw) && Array.isArray(raw.sections)) {
        refs = versionJsonRefs(raw, registry);
      }
    } catch {
      // Unreadable version: contributes nothing.
    }
    entries[name] = refs;
  }
  return { entries, computed };
}

/** The page's version refs, filled from its stored versions and persisted when it changed. */
export async function ensureVersionRefs(
  pb: PocketBase,
  ctx: OrgScope,
  page: RecordModel,
  registry: SectionRegistry,
  store: ObjectStore = getObjectStore(),
): Promise<VersionRefs> {
  const stored = parseVersionRefs(page.version_refs);
  const names = await retainedVersionNames(store, ctx.orgId, page.id);
  const { entries, computed } = await versionEntries(
    store,
    ctx.orgId,
    page.id,
    names,
    stored,
    registry,
  );
  const next = buildVersionRefs(entries);
  const pruned =
    stored !== null &&
    Object.keys(stored.versions).some((n) => !names.includes(n));
  if (computed || pruned || (stored === null && names.length > 0)) {
    await pb.collection("pages").update(page.id, { version_refs: next });
  }
  return next;
}

export type RefHolders = {
  draftPages: { id: string; title: string }[];
  versionPages: string[];
  popups: string[];
};

/**
 * Who references `id` as `kind`: pages whose draft rows do, pages whose kept versions do
 * (filling version_refs for published pages that lack it), and pop-ups whose items do.
 * Soft-deleted pop-ups count (07-28 choice 2: they are still served).
 */
export async function findRefHolders(
  pb: PocketBase,
  ctx: OrgScope,
  registry: SectionRegistry,
  kind: keyof SectionRefs,
  id: string,
  deps: { store?: ObjectStore } = {},
): Promise<RefHolders> {
  const org = { org: ctx.orgId };
  // 11-29: where-used lists leave out pages in Recently deleted. They still hold their refs
  // for the soft/hard rule and the GC (draftRefs, keptVersionRefs) until purged.
  const pages = await pb.collection("pages").getFullList({
    filter: pb.filter("organization = {:org} && deleted_at = ''", org),
    fields: "id,title,status,version_refs,published_at",
  });
  const titles = new Map(
    pages.map((p) => [p.id, typeof p.title === "string" ? p.title : ""]),
  );

  const rows = await pb.collection("page_sections").getFullList({
    filter: pb.filter("organization = {:org}", org),
    fields: "page,section_type,content",
  });
  const draftIds = new Set<string>();
  for (const r of rows) {
    if (rowsRefs([r], registry)[kind].includes(id)) {
      draftIds.add(String(r.page));
    }
  }

  const versionPages: string[] = [];
  let store: ObjectStore | null = deps.store ?? null;
  for (const p of pages) {
    let refs = parseVersionRefs(p.version_refs);
    const everPublished =
      p.status === "published" ||
      (typeof p.published_at === "string" && p.published_at !== "");
    if (refs === null && everPublished) {
      store ??= getObjectStore();
      refs = await ensureVersionRefs(pb, ctx, p, registry, store);
    }
    if (refs?.union[kind].includes(id)) versionPages.push(p.id);
  }

  const popupRows = await pb.collection("popups").getFullList({
    filter: pb.filter("organization = {:org}", org),
  });
  const popups: string[] = [];
  for (const p of popupRows) {
    if (p.id === id && kind === "popups") continue;
    if (popupRefs(p.content)[kind].includes(id)) popups.push(p.id);
  }

  return {
    draftPages: [...draftIds]
      .filter((pid) => titles.has(pid))
      .map((pid) => ({ id: pid, title: titles.get(pid)! })),
    versionPages,
    popups,
  };
}

export function hasRefHolders(h: RefHolders): boolean {
  return (
    h.draftPages.length > 0 || h.versionPages.length > 0 || h.popups.length > 0
  );
}

// ---- Org-wide scanners (07-28; content/soft-delete.ts unions them) ----

/** Union of the refs of every draft page_sections row of the org. */
export async function draftRefs(
  pb: PocketBase,
  scope: OrgScope,
  registry: SectionRegistry,
): Promise<SectionRefs> {
  const rows = await pb.collection("page_sections").getFullList({
    filter: pb.filter("organization = {:org}", { org: scope.orgId }),
    fields: "section_type,content",
  });
  return rowsRefs(rows, registry);
}

/** Union of every page's kept-version refs (version_refs filled for published pages lacking it). */
export async function keptVersionRefs(
  pb: PocketBase,
  scope: OrgScope,
  registry: SectionRegistry,
  deps: { store?: ObjectStore } = {},
): Promise<SectionRefs> {
  const pages = await pb.collection("pages").getFullList({
    filter: pb.filter("organization = {:org}", { org: scope.orgId }),
    fields: "id,status,version_refs,published_at",
  });
  const list: SectionRefs[] = [];
  let store: ObjectStore | null = deps.store ?? null;
  for (const p of pages) {
    let refs = parseVersionRefs(p.version_refs);
    const everPublished =
      p.status === "published" ||
      (typeof p.published_at === "string" && p.published_at !== "");
    if (refs === null && everPublished) {
      store ??= getObjectStore();
      refs = await ensureVersionRefs(pb, scope, p, registry, store);
    }
    if (refs) list.push(refs.union);
  }
  return unionRefs(list);
}

/** Each pop-up's item refs by pop-up id, soft-deleted pop-ups included (choice 2). */
export async function popupRefsById(
  pb: PocketBase,
  scope: OrgScope,
): Promise<Map<string, SectionRefs>> {
  const rows = await pb.collection("popups").getFullList({
    filter: pb.filter("organization = {:org}", { org: scope.orgId }),
    fields: "id,content",
  });
  return new Map(rows.map((r) => [r.id, popupRefs(r.content)]));
}
