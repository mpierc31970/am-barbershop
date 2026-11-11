// The value grammars for every non-colour and colour theme token (THEME-02, T-04-11;
// UI-SPEC "Role contract" non-colour tokens table; CONTEXT A2-Q3). The validator (write
// path) and the emitter (render path) share these, so a value that reaches CSS has always
// passed the same check twice. Every grammar is an anchored whole-string regex plus numeric
// range checks: never partial matches, never executed. That is what makes `}`, `;`,
// `</style>`, url() and expression() impossible in emitted CSS. Themes set sizes, radii and
// the overlay shadow only; weights and line heights stay fixed in CSS (D-UI-P4-3).
// Pure and Edge-safe.

/** Lowercase `#rrggbb` only (the solver's output form). */
export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/.test(v);
}

const ROOT_PX = 16;
const NUM = "(?:\\d{1,4}(?:\\.\\d{1,4})?)";
const ABS = new RegExp(`^(${NUM})(px|rem)$`);

/** "18px" -> 18, "1.125rem" -> 18 (16px root). Anything else -> null. */
export function toPx(v: string): number | null {
  if (typeof v !== "string") return null;
  const m = ABS.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "rem" ? n * ROOT_PX : n;
}

export type SizeToken = "body" | "h3" | "h2" | "display";

const TERM = `${NUM}(?:px|rem|vw)`;
const ABS_TERM = `${NUM}(?:px|rem)`;
const CLAMP = new RegExp(
  `^clamp\\(\\s*(${ABS_TERM})\\s*,\\s*(${TERM}(?:\\s*[+-]\\s*${TERM})*)\\s*,\\s*(${ABS_TERM})\\s*\\)$`,
);

/** A clamp(min, preferred, max) with absolute min/max inside [lo, hi] px, min <= max. */
function isClampWithin(v: string, lo: number, hi: number): boolean {
  const m = CLAMP.exec(v);
  if (!m) return false;
  const min = toPx(m[1] ?? "");
  const max = toPx(m[3] ?? "");
  if (min === null || max === null) return false;
  return min >= lo && max <= hi && min <= max;
}

function pxWithin(v: string, lo: number, hi: number): boolean {
  const px = toPx(v);
  return px !== null && px >= lo && px <= hi;
}

/**
 * body px 16-20; h3 px 20-28; h2 px 28-44 or a clamp() bounded to 28-44px;
 * display clamp() only, min >= 2.25rem and max <= 6rem (craft floor).
 */
export function isSizeToken(token: SizeToken, v: unknown): boolean {
  if (typeof v !== "string") return false;
  switch (token) {
    case "body":
      return pxWithin(v, 16, 20);
    case "h3":
      return pxWithin(v, 20, 28);
    case "h2":
      return pxWithin(v, 28, 44) || isClampWithin(v, 28, 44);
    case "display":
      return isClampWithin(v, 2.25 * ROOT_PX, 6 * ROOT_PX);
    default:
      return false;
  }
}

export type RadiusKind = "button" | "media";

const RADIUS = /^(\d{1,3}(?:\.\d)?)px$/;
const RADIUS_MAX: Readonly<Record<RadiusKind, number>> = {
  button: 999,
  media: 24,
};

/** button 0-999px, media 0-24px; integer or one-decimal px only. */
export function isRadius(kind: RadiusKind, v: unknown): boolean {
  if (typeof v !== "string") return false;
  const m = RADIUS.exec(v);
  if (!m) return false;
  const n = Number(m[1]);
  const max = RADIUS_MAX[kind];
  return max !== undefined && n >= 0 && n <= max;
}

const LEN = "(-?\\d{1,3}(?:\\.\\d{1,2})?)(?:px)?";
const SHADOW = new RegExp(
  `^${LEN} ${LEN} ${LEN}(?: ${LEN})? rgb\\((\\d{1,3}) (\\d{1,3}) (\\d{1,3}) / (\\d(?:\\.\\d{1,3})?)\\)$`,
);

function isLength(raw: string, n: number): boolean {
  // A unitless length is only legal as zero (CSS).
  return n === 0 || raw.endsWith("px");
}

/**
 * One box-shadow: `<x>px <y>px <blur>px [<spread>px] rgb(r g b / a)`, y > 0, blur > 0,
 * channels 0-255, alpha 0-1. No inset, no second layer (craft floor: no zero-blur).
 */
export function isOverlayShadow(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const m = SHADOW.exec(v);
  if (!m) return false;
  // Re-read each length token with its unit to enforce "unitless only when zero".
  const tokens = v.slice(0, v.indexOf(" rgb(")).split(" ");
  const nums = tokens.map((t) => Number(t.replace(/px$/, "")));
  if (!tokens.every((t, i) => isLength(t, nums[i] ?? NaN))) return false;
  const [, y = 0, blur = 0] = nums;
  if (!(y > 0) || !(blur > 0)) return false;
  const channels = [m[5], m[6], m[7]].map(Number);
  if (!channels.every((c) => c >= 0 && c <= 255)) return false;
  const alpha = Number(m[8]);
  return alpha >= 0 && alpha <= 1;
}
