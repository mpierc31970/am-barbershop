// OKLCH colour maths for the theme solver and importer (THEME-05; CONTEXT Claude's
// Discretion: hand-written, no colour dependency, 04-RESEARCH "Alternatives Considered").
// Coefficients are Ottosson's OKLab (https://bottosson.github.io/posts/oklab/), as listed in
// 04-RESEARCH "Code Examples". Gamut mapping reduces chroma at fixed L and h (CSS Color 4
// style), so hue and lightness are preserved.
// T-04-01: parseColor accepts only strict anchored forms and returns null for anything else;
// toHex always yields lowercase #rrggbb, so no CSS metacharacter can pass through.
// Pure and Edge-safe.
import { InvalidInput } from "../errors";
import type { Oklch, Rgb } from "./types";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NUM = "(\\d{1,3}(?:\\.\\d+)?)";
const RGB_SPACE_RE = new RegExp(
  `^rgb\\(\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s*\\)$`,
);
const RGB_COMMA_RE = new RegExp(
  `^rgb\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)$`,
);
const OKLCH_RE =
  /^oklch\(\s*(\d{1,3}(?:\.\d+)?|\.\d+)(%?)\s+(\d{1,2}(?:\.\d+)?|\.\d+)\s+(\d{1,3}(?:\.\d+)?|\.\d+)\s*\)$/;

const GAMUT_EPS = 1e-6;
const GAMUT_ITERATIONS = 30;

/** Parse a colour string into sRGB 0..255, or null when it is not an accepted form. */
export function parseColor(input: string): Rgb | null {
  if (typeof input !== "string") return null;
  const s = input.trim();

  const hex = HEX_RE.exec(s);
  if (hex) {
    let h = (hex[1] ?? "").toLowerCase();
    if (h.length === 3) h = [...h].map((ch) => ch + ch).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  const rgb = RGB_SPACE_RE.exec(s) ?? RGB_COMMA_RE.exec(s);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number) as [
      number,
      number,
      number,
    ];
    if ([r, g, b].some((v) => !(v >= 0 && v <= 255))) return null;
    return { r, g, b };
  }

  const ok = OKLCH_RE.exec(s);
  if (ok) {
    let l = Number(ok[1]);
    if (ok[2] === "%") l /= 100;
    const c = Number(ok[3]);
    const h = Number(ok[4]);
    if (!(l >= 0 && l <= 1) || !(c >= 0) || !(h >= 0 && h <= 360)) return null;
    return oklchToSrgb(gamutMap({ l, c, h: normHue(h) }));
  }

  return null;
}

/** Lowercase `#rrggbb`, each channel clamped to 0..255 and rounded. */
export function toHex(rgb: Rgb): string {
  const part = (v: number) => {
    const n = Number.isFinite(v)
      ? Math.round(Math.min(255, Math.max(0, v)))
      : 0;
    return n.toString(16).padStart(2, "0");
  };
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
  const sign = c < 0 ? -1 : 1;
  const a = Math.abs(c);
  return sign * (a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055);
}

function normHue(h: number): number {
  const n = h % 360;
  return n < 0 ? n + 360 : n;
}

/** sRGB 0..255 -> OKLCH. */
export function srgbToOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r / 255);
  const g = toLinear(rgb.g / 255);
  const b = toLinear(rgb.b / 255);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(A * A + B * B);
  const h = c < 1e-9 ? 0 : normHue((Math.atan2(B, A) * 180) / Math.PI);
  return { l: L, c, h };
}

/** OKLCH -> sRGB 0..255, unclamped (may be out of gamut). */
export function oklchToSrgb(o: Oklch): Rgb {
  const hr = (o.h * Math.PI) / 180;
  const A = o.c * Math.cos(hr);
  const B = o.c * Math.sin(hr);

  const l_ = o.l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = o.l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = o.l - 0.0894841775 * A - 1.291485548 * B;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: fromLinear(r) * 255,
    g: fromLinear(g) * 255,
    b: fromLinear(b) * 255,
  };
}

/** True when every channel lies within 0..255 (1e-6 tolerance, in 0..1 units). */
export function inGamut(rgb: Rgb): boolean {
  return [rgb.r, rgb.g, rgb.b].every(
    (v) =>
      Number.isFinite(v) && v / 255 >= -GAMUT_EPS && v / 255 <= 1 + GAMUT_EPS,
  );
}

/** Reduce chroma at fixed l and h (binary search) until the colour is in sRGB gamut. */
export function gamutMap(o: Oklch): Oklch {
  if (inGamut(oklchToSrgb(o))) return o;
  let lo = 0;
  let hi = o.c;
  for (let i = 0; i < GAMUT_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToSrgb({ l: o.l, c: mid, h: o.h }))) lo = mid;
    else hi = mid;
  }
  return { l: o.l, c: lo, h: o.h };
}

/** `#rrggbb` (or any parseColor form) -> OKLCH. Unparseable input throws InvalidInput. */
export function hexToOklch(hex: string): Oklch {
  const rgb = parseColor(hex);
  if (!rgb) throw new InvalidInput("unrecognised colour");
  return srgbToOklch(rgb);
}

/** OKLCH -> lowercase `#rrggbb`, gamut-mapped first. */
export function oklchToHex(o: Oklch): string {
  return toHex(oklchToSrgb(gamutMap(o)));
}
