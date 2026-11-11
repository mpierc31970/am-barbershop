// The deny-by-default validator for organizations.design (THEME-01, THEME-02 safety half,
// D44; CONTEXT A1-Q1, A2-Q3, A2-Q4; T-04-11..T-04-14). Only a complete schemaVersion 2
// design whose every value passes its grammar, whose fonts are in the catalog and whose
// enforced contrast pairs all meet their minimum is accepted. Copies the banner.ts shape:
// own() reads, a fresh object built field by field, input is never spread, extra keys are
// dropped, failures throw InvalidInput with the UI-SPEC "Import report contract" copy.
//
// Contrast is re-measured from the roles on every write (THEME-05 defence in depth): a
// stored theme is always AA, and stored `pairs` never come from input. `spacing` is
// provenance only (D-UI-P4-4) and `motion` is unused in v1.0; both are accepted as flat
// objects of primitive values. `source` is capped at SOURCE_MAX_BYTES (RESEARCH A2).
//
// projectPublicDesign is the render-side pick: seven keys, never `source` (CONTEXT A2-Q3).
// It does not grammar-check values; the emitter does, per token. Pure and Edge-safe.
import { InvalidInput } from "../errors";
import { bodySuggestions, findFont, nearestFont } from "./fonts";
import type { FontRole } from "./fonts";
import { isHexColor, isOverlayShadow, isRadius, isSizeToken } from "./grammar";
import type { RadiusKind, SizeToken } from "./grammar";
import { ROLES, isRole } from "./roles";
import type { RoleMap } from "./roles";
import { evaluatePairs } from "./solver";
import type {
  Adjustment,
  OrganizationDesign,
  PublicDesign,
  ThemeRounded,
  ThemeShadows,
  ThemeTypography,
} from "./types";

/** 256 KB: the authored DESIGN.md + sidecar never needs more (RESEARCH A2, T-04-13). */
export const SOURCE_MAX_BYTES = 262144;

const NAME_MAX = 80;
const FLAT_MAX_KEYS = 64;
const FLAT_VALUE_MAX = 200;
const REASON_MAX = 300;
const VALUE_ECHO_MAX = 80;

const MALFORMED_COPY = "The theme is malformed.";
const SCHEMA_COPY =
  "This theme is not schemaVersion 2. Re-import it with npm run theme:import.";
const NAME_COPY = `Give the theme a name under ${NAME_MAX} characters.`;
const SOURCE_SIZE_COPY =
  "The authored source is larger than 256 KB (SOURCE_MAX_BYTES). Trim DESIGN.md or design.json.";
const SOURCE_COPY = "The authored source is malformed.";
const HASH_COPY = "sourceHash must be 64 lowercase hex characters.";
const IMPORTED_AT_COPY = "importedAt must be a valid date and time.";
const ADJUSTMENTS_COPY = "contrast.adjustments is malformed.";

export const MISSING_ROLE_COPY = (role: string): string =>
  `Missing role: ${role}. Add it to extensions.roles in design.json, then run again.`;

export const UNKNOWN_FONT_COPY = (name: string, nearest: string): string =>
  `"${echo(name)}" is not in the font catalog. Nearest: ${nearest}. Pick a catalog family or add one to the catalog (a deploy).`;

export const DISPLAY_AS_BODY_COPY = (
  name: string,
  suggestions: readonly string[],
): string =>
  `${name} is a display face and can't be the body font. Try ${suggestions.join(" or ")}.`;

export const BAD_VALUE_COPY = (
  path: string,
  value: unknown,
  rule: string,
): string =>
  `${path} "${echo(String(value))}" is outside the allowed range (${rule}).`;

export const CONTRAST_COPY = (
  fg: string,
  bg: string,
  ratio: number,
  min: number,
): string =>
  `${fg} on ${bg} is ${ratio.toFixed(2)}:1, below the required ${min.toFixed(1)}:1. Import the theme again so the solver can fix it.`;

export const SIZE_RULES: Readonly<Record<SizeToken, string>> = {
  body: "16px to 20px",
  h3: "20px to 28px",
  h2: "28px to 44px, or a clamp() within that",
  display: "clamp() only, min 2.25rem, max 6rem",
};

export const RADIUS_RULES: Readonly<Record<RadiusKind, string>> = {
  button: "0px to 999px",
  media: "0px to 24px",
};

export const SHADOW_RULE =
  "one shadow: x y blur [spread] rgb(r g b / a), y and blur above 0";

type Raw = Record<string, unknown>;

function echo(s: string): string {
  return s.length > VALUE_ECHO_MAX ? `${s.slice(0, VALUE_ECHO_MAX)}...` : s;
}

function own(raw: Raw, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
}

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function object(raw: Raw, key: string): Raw {
  const v = own(raw, key);
  if (!isObject(v)) throw new InvalidInput(`${key}: ${MALFORMED_COPY}`);
  return v;
}

function roles(raw: Raw): RoleMap {
  const r = object(raw, "roles");
  const out = {} as RoleMap;
  for (const role of ROLES) {
    const v = own(r, role);
    if (v === undefined || v === null || v === "")
      throw new InvalidInput(MISSING_ROLE_COPY(role));
    if (!isHexColor(v))
      throw new InvalidInput(
        BAD_VALUE_COPY(`roles.${role}`, v, "lowercase #rrggbb"),
      );
    out[role] = v;
  }
  return out;
}

function family(raw: Raw, key: string, role: FontRole): string {
  const v = own(raw, key);
  const name = typeof v === "string" ? v : "";
  const font = findFont(name);
  if (font === null)
    throw new InvalidInput(
      UNKNOWN_FONT_COPY(name, nearestFont(name, role).name),
    );
  if (!font.roles.includes(role))
    throw new InvalidInput(
      DISPLAY_AS_BODY_COPY(font.name, bodySuggestions(font.name)),
    );
  return font.name;
}

function size(raw: Raw, token: SizeToken): string {
  const v = own(raw, token);
  if (!isSizeToken(token, v))
    throw new InvalidInput(
      BAD_VALUE_COPY(`typography.${token}`, v, SIZE_RULES[token]),
    );
  return v as string;
}

function typography(raw: Raw): ThemeTypography {
  const t = object(raw, "typography");
  return {
    headingFamily: family(t, "headingFamily", "heading"),
    bodyFamily: family(t, "bodyFamily", "body"),
    body: size(t, "body"),
    h3: size(t, "h3"),
    h2: size(t, "h2"),
    display: size(t, "display"),
  };
}

function radius(raw: Raw, kind: RadiusKind): string {
  const v = own(raw, kind);
  if (!isRadius(kind, v))
    throw new InvalidInput(
      BAD_VALUE_COPY(`rounded.${kind}`, v, RADIUS_RULES[kind]),
    );
  return v as string;
}

function rounded(raw: Raw): ThemeRounded {
  const r = object(raw, "rounded");
  return { button: radius(r, "button"), media: radius(r, "media") };
}

function shadows(raw: Raw): ThemeShadows {
  const s = object(raw, "shadows");
  const overlay = own(s, "overlay");
  if (!isOverlayShadow(overlay))
    throw new InvalidInput(
      BAD_VALUE_COPY("shadows.overlay", overlay, SHADOW_RULE),
    );
  return { overlay: overlay as string };
}

const FLAT_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** A flat object of primitive values, rebuilt key by key (T-04-14). */
function flat(
  raw: Raw,
  key: string,
): Record<string, string | number | boolean> {
  const v = own(raw, key);
  if (v === undefined || v === null) return {};
  if (!isObject(v)) throw new InvalidInput(`${key}: ${MALFORMED_COPY}`);
  const keys = Object.keys(v);
  if (keys.length > FLAT_MAX_KEYS)
    throw new InvalidInput(`${key}: ${MALFORMED_COPY}`);
  const out: Record<string, string | number | boolean> = {};
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k) || !FLAT_KEY.test(k)) continue;
    const val = own(v, k);
    const ok =
      (typeof val === "string" && val.length <= FLAT_VALUE_MAX) ||
      (typeof val === "number" && Number.isFinite(val)) ||
      typeof val === "boolean";
    if (!ok) throw new InvalidInput(`${key}.${k}: ${MALFORMED_COPY}`);
    out[k] = val;
  }
  return out;
}

function source(raw: Raw): OrganizationDesign["source"] {
  const s = object(raw, "source");
  let json: string;
  try {
    json = JSON.stringify(s);
  } catch {
    throw new InvalidInput(SOURCE_COPY);
  }
  if (new TextEncoder().encode(json).length > SOURCE_MAX_BYTES)
    throw new InvalidInput(SOURCE_SIZE_COPY);
  // A JSON round trip is the fresh deep copy: JSON.parse makes "__proto__" an own data
  // property, never a prototype, so nothing in the authored source can pollute.
  const copy = JSON.parse(json) as Raw;
  const designMd = own(copy, "designMd");
  if (!isObject(designMd)) throw new InvalidInput(SOURCE_COPY);
  const frontMatter = own(designMd, "frontMatter");
  const body = own(designMd, "body");
  if (!isObject(frontMatter) || typeof body !== "string")
    throw new InvalidInput(SOURCE_COPY);
  const sidecar = own(copy, "sidecar");
  if (sidecar !== null && sidecar !== undefined && !isObject(sidecar))
    throw new InvalidInput(SOURCE_COPY);
  return {
    designMd: { frontMatter, body },
    sidecar: isObject(sidecar) ? sidecar : null,
  };
}

const HEX_ANY = /^#[0-9a-fA-F]{6}$/;

function adjustments(raw: Raw): Adjustment[] {
  const c = object(raw, "contrast");
  const list = own(c, "adjustments");
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > ROLES.length)
    throw new InvalidInput(ADJUSTMENTS_COPY);
  return list.map((item: unknown): Adjustment => {
    if (!isObject(item)) throw new InvalidInput(ADJUSTMENTS_COPY);
    const role = own(item, "role");
    const from = own(item, "from");
    const to = own(item, "to");
    const fromL = own(item, "fromL");
    const toL = own(item, "toL");
    const reason = own(item, "reason");
    const fallback = own(item, "fallback");
    if (
      !isRole(role) ||
      typeof from !== "string" ||
      !HEX_ANY.test(from) ||
      !isHexColor(to) ||
      typeof fromL !== "number" ||
      !Number.isFinite(fromL) ||
      typeof toL !== "number" ||
      !Number.isFinite(toL) ||
      typeof reason !== "string" ||
      reason.length > REASON_MAX ||
      typeof fallback !== "boolean"
    )
      throw new InvalidInput(ADJUSTMENTS_COPY);
    return { role, from, to, fromL, toL, reason, fallback };
  });
}

function sourceHash(raw: Raw): string {
  const v = own(raw, "sourceHash");
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v))
    throw new InvalidInput(HASH_COPY);
  return v;
}

function importedAt(raw: Raw): string {
  const v = own(raw, "importedAt");
  const ms = typeof v === "string" ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms)) throw new InvalidInput(IMPORTED_AT_COPY);
  return new Date(ms).toISOString();
}

export function validateOrganizationDesign(raw: unknown): OrganizationDesign {
  if (!isObject(raw)) throw new InvalidInput(MALFORMED_COPY);
  const r = raw;
  if (own(r, "schemaVersion") !== 2) throw new InvalidInput(SCHEMA_COPY);

  const nameRaw = own(r, "name");
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (name === "" || name.length > NAME_MAX) throw new InvalidInput(NAME_COPY);

  const roleMap = roles(r);
  const pairs = evaluatePairs(roleMap);
  for (const p of pairs) {
    if (p.min !== null && !p.pass)
      throw new InvalidInput(CONTRAST_COPY(p.fg, p.bg, p.ratio, p.min));
  }

  return {
    schemaVersion: 2,
    name,
    source: source(r),
    roles: roleMap,
    typography: typography(r),
    rounded: rounded(r),
    spacing: flat(r, "spacing") as Record<string, string>,
    shadows: shadows(r),
    motion: flat(r, "motion"),
    contrast: { pairs, adjustments: adjustments(r) },
    importedAt: importedAt(r),
    sourceHash: sourceHash(r),
  };
}

function pick(raw: unknown, keys: readonly string[]): Raw {
  const out: Raw = {};
  if (!isObject(raw)) return out;
  for (const k of keys) {
    const v = own(raw, k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const TYPOGRAPHY_KEYS = [
  "headingFamily",
  "bodyFamily",
  "body",
  "h3",
  "h2",
  "display",
] as const;

/** The render-only projection: seven own-property picks, never `source` (T-04-12). */
export function projectPublicDesign(raw: unknown): PublicDesign | null {
  if (!isObject(raw)) return null;
  return {
    schemaVersion: own(raw, "schemaVersion"),
    name: own(raw, "name"),
    roles: pick(own(raw, "roles"), ROLES),
    typography: pick(own(raw, "typography"), TYPOGRAPHY_KEYS),
    rounded: pick(own(raw, "rounded"), ["button", "media"]),
    shadows: pick(own(raw, "shadows"), ["overlay"]),
    sourceHash: own(raw, "sourceHash"),
  } as PublicDesign;
}
