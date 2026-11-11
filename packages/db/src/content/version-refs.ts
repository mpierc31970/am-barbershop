// pages.version_refs (07-12 choice 11; CONT-36, D275). Pure. A published page keeps the refs
// (pop-ups, forms, media) of each retained version, so "is this referenced by a kept
// version?" never reads version JSON. Shape:
//   { v: 1, union: SectionRefs, versions: Record<versionFileName, SectionRefs> }
// `versions` is keyed by the version file name (the part after the page's version prefix;
// names sort by time) and holds at most VERSIONS_KEPT entries. `union` is their union in
// version order. Malformed stored values parse to null (deny by default) and are rebuilt.
// 07-28 reuses this for forms and pop-ups.
import { emptyRefs, unionRefs, type SectionRefs } from "@cds/core/content";

/** Page versions kept per page (D184). publish.ts re-exports it. */
export const VERSIONS_KEPT = 10;

export type VersionRefs = {
  v: 1;
  union: SectionRefs;
  versions: Record<string, SectionRefs>;
};

const ID_RE = /^[a-z0-9]{15}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;
const KINDS = ["popups", "forms", "media"] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseRefs(raw: unknown): SectionRefs | null {
  if (!isRecord(raw)) return null;
  const out = emptyRefs();
  for (const k of KINDS) {
    const list = Object.hasOwn(raw, k) ? raw[k] : undefined;
    if (!Array.isArray(list)) return null;
    for (const id of list) {
      if (typeof id !== "string" || !ID_RE.test(id)) return null;
    }
    out[k] = [...new Set(list as string[])];
  }
  return out;
}

export function parseVersionRefs(raw: unknown): VersionRefs | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (!Object.hasOwn(raw, "versions") || !isRecord(raw.versions)) return null;
  const versions: Record<string, SectionRefs> = {};
  for (const [name, refs] of Object.entries(raw.versions)) {
    if (!NAME_RE.test(name)) return null;
    const parsed = parseRefs(refs);
    if (!parsed) return null;
    versions[name] = parsed;
  }
  if (!Object.hasOwn(raw, "union") || !parseRefs(raw.union)) return null;
  // The union is always recomputed from the entries (never trusted as stored).
  return buildVersionRefs(versions);
}

/** Entries in version (name) order, newest VERSIONS_KEPT kept, union in first-seen order. */
export function buildVersionRefs(
  versions: Readonly<Record<string, SectionRefs>>,
): VersionRefs {
  const names = Object.keys(versions)
    .filter((n) => NAME_RE.test(n))
    .sort()
    .slice(-VERSIONS_KEPT);
  const kept: Record<string, SectionRefs> = {};
  for (const n of names) {
    const r = versions[n]!;
    kept[n] = {
      popups: [...r.popups],
      forms: [...r.forms],
      media: [...r.media],
    };
  }
  return { v: 1, union: unionRefs(names.map((n) => kept[n]!)), versions: kept };
}

/** True when any retained version references `id` as `kind`. */
export function versionRefsHas(
  raw: unknown,
  kind: keyof SectionRefs,
  id: string,
): boolean {
  const parsed = parseVersionRefs(raw);
  return parsed !== null && parsed.union[kind].includes(id);
}
