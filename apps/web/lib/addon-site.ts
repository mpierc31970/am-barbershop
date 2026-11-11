// Live add-on block data for the tenant site and the builder preview (ADDON-05, ADDON-08;
// D253; CONTEXT A2-Q3; RESEARCH Patterns 6 and 9, Pitfall 9; T-05-49, T-05-51).
//
// The registry's server entry is imported first: it registers every add-on collection with
// @cds/db (exports fail closed without it) and exposes the pure blockData transforms.
//   - loadAddonBlockData: visitor path. Groups the page's sections by owning add-on, skips
//     owners that are not active, reads each owner's blockCollections through the cached,
//     org-scoped public read and merges blockData results by section id.
//   - previewAddonBlockData: builder preview (OrgContext). Same transform over the add-on's
//     records through addonRepo, filtered to published and not held, so preview shows what
//     the site will show.
//   - isDrawnFor: core types always draw; an add-on block draws only with an active owner
//     and non-empty data, so an empty or disabled block never takes the page h1.
// Every lookup into a map keyed by untrusted strings is an own-property lookup.
import { ADDON_REGISTRY, ADDON_SERVER } from "@cds/addon-registry/server";
import { Forbidden } from "@cds/core";
import type { AddonSectionRef } from "@cds/addon-registry/server";
import {
  addonRepo,
  type AddonRecord,
  type OrgContext,
  type SiteContext,
} from "@cds/db";
import { addonDeps } from "./addons";
import { getAddonRecords } from "./site-cache";

type SectionLike = {
  id: string;
  section_type: string;
  content: unknown;
};

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The page's add-on sections grouped by owning slug, active owners only. */
function groupByOwner(
  sections: readonly SectionLike[],
  active: readonly string[],
): Map<string, AddonSectionRef[]> {
  const on = new Set(active);
  const groups = new Map<string, AddonSectionRef[]>();
  for (const s of sections) {
    if (!s || typeof s.id !== "string" || typeof s.section_type !== "string") {
      continue;
    }
    const slug = ADDON_REGISTRY.ownerOf(s.section_type);
    if (!slug || !on.has(slug) || !hasOwn(ADDON_SERVER, slug)) continue;
    const list = groups.get(slug) ?? [];
    list.push({
      id: s.id,
      section_type: s.section_type,
      content: isRecord(s.content) ? s.content : {},
    });
    groups.set(slug, list);
  }
  return groups;
}

async function assemble(
  groups: Map<string, AddonSectionRef[]>,
  read: (slug: string, collection: string) => Promise<AddonRecord[]>,
  now: Date,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = Object.create(null);
  await Promise.all(
    [...groups].map(async ([slug, refs]) => {
      // Each owner is isolated (C-WR-03, D156): a failed read or a throwing blockData drops
      // only that owner's blocks. With no entry, isDrawnFor skips them (and they give up the
      // h1), so core blocks and the other add-ons still render for visitors.
      try {
        const mod = ADDON_SERVER[slug]!;
        const records: Record<string, AddonRecord[]> = Object.create(null);
        await Promise.all(
          mod.blockCollections.map(async (c) => {
            records[c] = await read(slug, c);
          }),
        );
        const data = mod.blockData(refs, records, now);
        if (!isRecord(data)) return;
        // Only ids of this owner's own sections are taken from its result.
        for (const ref of refs) {
          if (hasOwn(data, ref.id)) out[ref.id] = data[ref.id];
        }
      } catch (err) {
        console.error("[site] add-on block data failed", slug, err);
      }
    }),
  );
  return out;
}

/** Visitor path: section id -> blockData result, only for active owners (D253). */
export async function loadAddonBlockData(
  site: SiteContext,
  sections: readonly SectionLike[],
  active: readonly string[],
  now: Date,
): Promise<Record<string, unknown>> {
  const groups = groupByOwner(sections, active);
  if (groups.size === 0) return Object.create(null);
  return assemble(groups, (slug, c) => getAddonRecords(site, slug, c), now);
}

/**
 * Builder preview: the same transform over the org's records (published, not held). A
 * member without the add-on's read grant sees the block empty rather than an error.
 */
export async function previewAddonBlockData(
  ctx: OrgContext,
  sections: readonly SectionLike[],
  active: readonly string[],
  now: Date,
): Promise<Record<string, unknown>> {
  const groups = groupByOwner(sections, active);
  if (groups.size === 0) return Object.create(null);
  const deps = addonDeps();
  return assemble(
    groups,
    async (slug, c) => {
      try {
        const repo = addonRepo(ctx, deps, slug).collection(c);
        const [rows, holds] = await Promise.all([
          repo.list(),
          repo.openHolds(),
        ]);
        const held = new Set(holds);
        return rows.filter((r) => r.is_published === true && !held.has(r.id));
      } catch (err) {
        if (err instanceof Forbidden) return [];
        throw err;
      }
    },
    now,
  );
}

function hasContent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** Core types draw; an add-on type needs an active owner and non-empty data. */
export function isDrawnFor(
  active: readonly string[],
  boundData: Readonly<Record<string, unknown>>,
): (section: { id: string; section_type: string }) => boolean {
  const on = new Set(active);
  return (section) => {
    const slug = ADDON_REGISTRY.ownerOf(section.section_type);
    if (!slug) return true;
    if (!on.has(slug)) return false;
    return hasOwn(boundData, section.id) && hasContent(boundData[section.id]);
  };
}
