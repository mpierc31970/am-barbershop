// The theme emitter (THEME-02, CONTEXT A2-Q3, D-UI-P4-8/9/10): a stored design becomes one
// scoped CSS rule of --site-* custom properties at render time, no deploy involved. Every
// value is re-checked against the same anchored grammar the validator used; a value that
// fails falls back to the neutral preset's value for that token only, except the eight
// colour roles, which fall back together when any one is bad or any enforced contrast pair
// fails (WR-02: a render is always AA), and a design that is
// missing or unusable falls back to the neutral preset entirely (hash 00000000). Nothing
// outside the grammar can reach the CSS, so `}`, `;`, `<`, `>`, url(), @import and
// expression() never appear in the output (T-04-15). The data-theme hash is taken only from a
// 64-hex sourceHash (T-04-16). It reads PublicDesign fields only, never the authored source
// (T-04-17). No solving at render (D47 c2): the only derived tokens are the backdrop (text at
// 55% alpha) and focus (var(--site-text)) (D-UI-P4-9). Weights, line heights (D-UI-P4-3) and
// spacing (D-UI-P4-4) are not emitted. Pure and Edge-safe: no node:*, no Date, no randomness.
import { parseColor } from "./color";
import { findFont, fontStack } from "./fonts";
import type { FontRole } from "./fonts";
import { isHexColor, isOverlayShadow, isRadius, isSizeToken } from "./grammar";
import type { RadiusKind, SizeToken } from "./grammar";
import { NEUTRAL_DESIGN, NEUTRAL_HASH } from "./neutral";
import { ROLES } from "./roles";
import type { RoleMap } from "./roles";
import { evaluatePairs } from "./solver";
import type { PublicDesign } from "./types";
import { projectPublicDesign } from "./validate";

/** One tenant's theme: the data-theme attribute value and the scoped CSS rule. */
export type ThemeScope = { hash: string; css: string };

type Loose = Record<string, unknown>;

function group(design: unknown, key: string): Loose {
  if (typeof design !== "object" || design === null) return {};
  const v = Object.prototype.hasOwnProperty.call(design, key)
    ? (design as Loose)[key]
    : undefined;
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Loose)
    : {};
}

function field(g: Loose, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(g, key) ? g[key] : undefined;
}

const NEUTRAL_ROLES = NEUTRAL_DESIGN.roles;
const NEUTRAL_TYPE = NEUTRAL_DESIGN.typography;
const NEUTRAL_ROUNDED = NEUTRAL_DESIGN.rounded;
const NEUTRAL_SHADOWS = NEUTRAL_DESIGN.shadows;

function font(v: unknown, role: FontRole, neutral: string): string {
  const neutralStack = fontStack(neutral) ?? "";
  if (typeof v !== "string") return neutralStack;
  const f = findFont(v);
  if (f === null || !f.roles.includes(role)) return neutralStack;
  return fontStack(f.name) ?? neutralStack;
}

function size(g: Loose, token: SizeToken): string {
  const v = field(g, token);
  return isSizeToken(token, v) ? (v as string) : NEUTRAL_TYPE[token];
}

function radius(g: Loose, kind: RadiusKind): string {
  const v = field(g, kind);
  return isRadius(kind, v) ? (v as string) : NEUTRAL_ROUNDED[kind];
}

/** `rgb(R G B / 0.55)` from a validated lowercase hex. */
function backdrop(hex: string): string {
  const rgb = parseColor(hex) ?? parseColor(NEUTRAL_ROLES.text);
  const [r, g, b] = rgb
    ? [rgb.r, rgb.g, rgb.b].map((c) => Math.round(c))
    : [29, 28, 26];
  return `rgb(${r} ${g} ${b} / 0.55)`;
}

/**
 * The declaration list only, in a fixed order: the eight roles, backdrop, focus, the two
 * font stacks, the four sizes, the two radii and the overlay shadow. Every value is its
 * grammar-checked input or the neutral value for that token; the roles are all-or-nothing
 * (all eight valid and every enforced pair AA, else the neutral eight).
 */
export function designToCssVars(design: PublicDesign): string {
  const roles = group(design, "roles");
  const type = group(design, "typography");
  const rounded = group(design, "rounded");
  const shadows = group(design, "shadows");

  // The eight roles are one unit (WR-02, THEME-05): a per-role fallback would mix tenant and
  // neutral colours that were never contrast-checked together. Any bad role, or any enforced
  // pair below its minimum, and all eight fall back to the neutral preset.
  const rolesOk = ROLES.every((r) => isHexColor(field(roles, r)));
  const use: RoleMap =
    rolesOk && evaluatePairs(roles as RoleMap).every((p) => p.pass)
      ? (Object.fromEntries(
          ROLES.map((r) => [r, field(roles, r) as string]),
        ) as RoleMap)
      : NEUTRAL_ROLES;

  const decls: [string, string][] = [];
  for (const role of ROLES) decls.push([role, use[role]]);
  decls.push(["backdrop", backdrop(use.text)]);
  decls.push(["focus", "var(--site-text)"]);
  decls.push([
    "font-heading",
    font(field(type, "headingFamily"), "heading", NEUTRAL_TYPE.headingFamily),
  ]);
  decls.push([
    "font-body",
    font(field(type, "bodyFamily"), "body", NEUTRAL_TYPE.bodyFamily),
  ]);
  decls.push(["text-body", size(type, "body")]);
  decls.push(["text-h3", size(type, "h3")]);
  decls.push(["text-h2", size(type, "h2")]);
  decls.push(["text-display", size(type, "display")]);
  decls.push(["radius-button", radius(rounded, "button")]);
  decls.push(["radius-media", radius(rounded, "media")]);
  const overlay = field(shadows, "overlay");
  decls.push([
    "shadow-overlay",
    isOverlayShadow(overlay) ? (overlay as string) : NEUTRAL_SHADOWS.overlay,
  ]);

  return decls.map(([name, value]) => `--site-${name}:${value};`).join("");
}

const SOURCE_HASH = /^[0-9a-f]{64}$/;

/** A stored `organizations.design` (anything) -> one scoped rule of --site-* properties. */
export function resolveTheme(raw: unknown): ThemeScope {
  const design = projectPublicDesign(raw) ?? NEUTRAL_DESIGN;
  const { sourceHash } = design;
  const hash =
    typeof sourceHash === "string" && SOURCE_HASH.test(sourceHash)
      ? sourceHash.slice(0, 8)
      : NEUTRAL_HASH;
  return {
    hash,
    css: `[data-site][data-theme="${hash}"]{${designToCssVars(design)}}`,
  };
}
