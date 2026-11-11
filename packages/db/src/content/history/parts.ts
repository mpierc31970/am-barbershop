// Site-part history shapes (07-29; CONT-36, D184, D187; CONTEXT Area 5 row 3; choices 3-4).
// Pure. Deny by default twice: toSnapshot keeps only the registry's export fields, then
// pickPart keeps only the part's own fields. A new site_settings field is not in history
// until it is added to both lists.
import type { SiteHistoryPart } from "../../storage";

export const SITE_PART_FIELDS: Readonly<
  Record<SiteHistoryPart, readonly string[]>
> = Object.freeze({
  nav: Object.freeze(["nav"]),
  footer: Object.freeze(["footer"]),
  banner: Object.freeze(["banner"]),
  settings: Object.freeze(["language", "settings", "seo"]),
});

/** The part's fields of a snapshot (own properties only; missing -> null). */
export function pickPart(
  part: SiteHistoryPart,
  snap: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SITE_PART_FIELDS[part]) {
    out[f] =
      snap && Object.prototype.hasOwnProperty.call(snap, f)
        ? (snap[f] ?? null)
        : null;
  }
  return out;
}

/** Stable JSON with sorted object keys (Current badge and the duplicate check). */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v !== null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) {
        if (o[k] !== undefined) out[k] = norm(o[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value) ?? null);
}

/** A version id is the file stamp: 2026-09-28T14-14-00-000Z (no "/", no "."). */
export const SITE_VERSION_ID_RE =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3])-[0-5]\d-[0-5]\d-\d{3}Z$/;

const KEY_STAMP_RE = /\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/;

/** The version id of a key, or null for a foreign-shaped key. */
export function versionIdOf(key: string): string | null {
  const m = KEY_STAMP_RE.exec(key);
  return m && SITE_VERSION_ID_RE.test(m[1]!) ? m[1]! : null;
}

/** ISO instant of a version id (2026-09-28T14-14-00-000Z -> 2026-09-28T14:14:00.000Z). */
export function atOfVersionId(id: string): string {
  const [date, time] = id.split("T") as [string, string];
  const [h, m, s, ms] = time.replace(/Z$/, "").split("-");
  return `${date}T${h}:${m}:${s}.${ms}Z`;
}

export type SnapshotAuthor = { actor: string; staff: boolean } | null;

export type SiteSnapshotEnvelope = {
  v: 1;
  part: SiteHistoryPart;
  at: string;
  by: SnapshotAuthor;
  row: Record<string, unknown>;
};

const PARTS: readonly string[] = ["nav", "footer", "banner", "settings"];

/** Accept only `{ v: 1, part, at, by, row }`; anything else is null. */
export function parseEnvelope(raw: unknown): SiteSnapshotEnvelope | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.part !== "string" || !PARTS.includes(o.part)) return null;
  if (typeof o.at !== "string" || Number.isNaN(Date.parse(o.at))) return null;
  let by: SnapshotAuthor;
  if (o.by === null) by = null;
  else if (
    typeof o.by === "object" &&
    o.by !== null &&
    typeof (o.by as Record<string, unknown>).actor === "string" &&
    typeof (o.by as Record<string, unknown>).staff === "boolean"
  ) {
    const b = o.by as { actor: string; staff: boolean };
    by = { actor: b.actor, staff: b.staff };
  } else return null;
  if (typeof o.row !== "object" || o.row === null || Array.isArray(o.row)) {
    return null;
  }
  return {
    v: 1,
    part: o.part as SiteHistoryPart,
    at: o.at,
    by,
    row: o.row as Record<string, unknown>,
  };
}
