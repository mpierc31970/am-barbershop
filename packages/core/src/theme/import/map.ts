// Colour -> role mapping for the theme importer (THEME-03, CONTEXT A2-Q2, RESEARCH
// Pitfall 7). NODE-ONLY SUBPATH (see frontmatter.ts): never imported by Edge code.
//
// `extensions.roles` in design.json is authoritative: each role names a colour key from the
// DESIGN.md front matter (or, for convenience, a literal colour such as "#ffffff"). Without
// it, roles are derived from `extensions.colorMeta.role` (primary | secondary | tertiary |
// neutral | accent) plus luminance, and the derived name map is returned so the report can
// print it for the author to paste back in. A role that cannot be filled fails with the
// UI-SPEC missing-role copy.
import { InvalidInput } from "../../errors";
import { parseColor, toHex } from "../color";
import { contrastRatio, relativeLuminance } from "../contrast";
import { ROLES } from "../roles";
import type { Role, RoleMap } from "../roles";
import { BAD_VALUE_COPY, MISSING_ROLE_COPY } from "../validate";

type Raw = Record<string, unknown>;

export type RoleMapping = {
  /** The authored colour per role, lowercase #rrggbb (before the solver runs). */
  roles: RoleMap;
  /** The derived role -> colour-name map, or null when extensions.roles was used. */
  derived: RoleMap | null;
  /** The colour name (or literal) each role came from, for the report. */
  names: RoleMap;
};

const WHITE = "#ffffff";

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

function extensions(sidecar: Raw | null): Raw | null {
  if (sidecar === null) return null;
  const ext = own(sidecar, "extensions");
  return isObject(ext) ? ext : null;
}

/** Parse one authored colour to lowercase #rrggbb, or throw naming its key. */
function colourOf(name: string, value: unknown): string {
  const rgb = typeof value === "string" ? parseColor(value) : null;
  if (rgb === null) {
    throw new InvalidInput(
      BAD_VALUE_COPY(`colors.${name}`, value, "#hex, rgb() or oklch()"),
    );
  }
  return toHex(rgb);
}

function explicit(colors: Raw, map: Raw): RoleMapping {
  const roles = {} as RoleMap;
  const names = {} as RoleMap;
  for (const role of ROLES) {
    const name = own(map, role);
    if (typeof name !== "string" || name.trim() === "") {
      throw new InvalidInput(MISSING_ROLE_COPY(role));
    }
    const value = own(colors, name);
    if (value !== undefined) {
      roles[role] = colourOf(name, value);
    } else {
      const literal = parseColor(name);
      if (literal === null) throw new InvalidInput(MISSING_ROLE_COPY(role));
      roles[role] = toHex(literal);
    }
    names[role] = name;
  }
  return { roles, derived: null, names };
}

type Entry = { name: string; hex: string; lum: number };

function derive(colors: Raw, colorMeta: Raw | null): RoleMapping {
  const byRole = new Map<string, Entry[]>();
  if (colorMeta !== null) {
    for (const name of Object.keys(colorMeta)) {
      const meta = own(colorMeta, name);
      const value = own(colors, name);
      if (!isObject(meta) || value === undefined) continue;
      const role = own(meta, "role");
      if (typeof role !== "string") continue;
      const hex = colourOf(name, value);
      const list = byRole.get(role) ?? [];
      list.push({ name, hex, lum: relativeLuminance(hex) });
      byRole.set(role, list);
    }
  }

  // Lightest first; stable for equal luminance (authored order wins).
  const neutrals = [...(byRole.get("neutral") ?? [])].sort(
    (a, b) => b.lum - a.lum,
  );
  const n = neutrals.length;
  const pick = (role: Role, entry: Entry | undefined): Entry => {
    if (entry === undefined) throw new InvalidInput(MISSING_ROLE_COPY(role));
    return entry;
  };

  const surface = pick("surface", neutrals[0]);
  const raised = pick("surface-raised", n >= 3 ? neutrals[1] : undefined);
  const text = pick("text", n >= 2 ? neutrals[n - 1] : undefined);
  const muted = pick("text-muted", n >= 4 ? neutrals[n - 2] : undefined);
  const primary = pick("primary", byRole.get("primary")?.[0]);
  const accent = pick(
    "accent",
    byRole.get("accent")?.[0] ??
      byRole.get("tertiary")?.[0] ??
      byRole.get("secondary")?.[0],
  );

  // Border: an unused neutral nearest the middle, else the middle neutral.
  const used = new Set([surface.name, raised.name, text.name, muted.name]);
  const unused = neutrals.filter((e) => !used.has(e.name));
  const border =
    unused.length > 0
      ? pick("border", unused[Math.floor((unused.length - 1) / 2)])
      : pick("border", neutrals[Math.floor(n / 2)]);

  // primary-contrast: the lightest neutral unless #ffffff contrasts more with primary.
  const pcIsWhite =
    contrastRatio(WHITE, primary.hex) > contrastRatio(surface.hex, primary.hex);
  const pc: Entry = pcIsWhite ? { name: WHITE, hex: WHITE, lum: 1 } : surface;

  const chosen: Record<Role, Entry> = {
    surface,
    "surface-raised": raised,
    text,
    "text-muted": muted,
    primary,
    "primary-contrast": pc,
    accent,
    border,
  };
  const roles = {} as RoleMap;
  const names = {} as RoleMap;
  for (const role of ROLES) {
    roles[role] = chosen[role].hex;
    names[role] = chosen[role].name;
  }
  return { roles, derived: { ...names }, names };
}

/**
 * Map the front-matter colours to the eight roles. `sidecar` is the parsed design.json (or
 * null when there is none).
 */
export function mapRoles(
  colors: Record<string, string>,
  sidecar: Record<string, unknown> | null,
): RoleMapping {
  const palette: Raw = isObject(colors) ? colors : {};
  const ext = extensions(isObject(sidecar) ? sidecar : null);
  const map = ext === null ? undefined : own(ext, "roles");
  if (isObject(map)) return explicit(palette, map);
  const meta = ext === null ? undefined : own(ext, "colorMeta");
  return derive(palette, isObject(meta) ? meta : null);
}
