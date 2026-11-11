// Nearest plain colour name for the PaletteStrip's spoken label (06-21; 06-UI-SPEC
// Accessibility "PaletteStrip": "Colours from your mood board: deep green, cream, rust, …").
// A small fixed table matched by distance in OKLab (perceptual), so "a dark desaturated
// green" reads as "deep green" rather than a hex. Pure and deterministic (ties keep the
// table order). The hex values here are reference points for naming only, never painted.
import { hexToOklch } from "@cds/core/theme";

const TABLE: readonly (readonly [string, string])[] = [
  ["black", "#111111"],
  ["charcoal", "#36454f"],
  ["grey", "#808080"],
  ["silver", "#c0c0c0"],
  ["white", "#ffffff"],
  ["cream", "#f3ecd8"],
  ["beige", "#d9c8a9"],
  ["sand", "#c2b280"],
  ["tan", "#b08a5a"],
  ["brown", "#6b4423"],
  ["dark brown", "#3b2416"],
  ["rust", "#b7410e"],
  ["terracotta", "#c8664a"],
  ["red", "#c62828"],
  ["deep red", "#7b1e1e"],
  ["coral", "#f07e62"],
  ["pink", "#f2a2b8"],
  ["blush", "#f1d3d0"],
  ["magenta", "#b0307a"],
  ["orange", "#ee7b22"],
  ["peach", "#f6c3a0"],
  ["gold", "#c9a227"],
  ["mustard", "#d8a31a"],
  ["yellow", "#f5d63d"],
  ["olive", "#6f7032"],
  ["sage", "#9caf88"],
  ["green", "#3c9a4a"],
  ["deep green", "#1f4d36"],
  ["mint", "#b4e3c8"],
  ["teal", "#1f7a7a"],
  ["turquoise", "#3cc5c0"],
  ["sky blue", "#8cc8ec"],
  ["blue", "#2f6fd0"],
  ["navy", "#1c2a52"],
  ["lavender", "#c7b8e6"],
  ["purple", "#6a3d9a"],
  ["plum", "#5a2a4a"],
];

type Lab = { L: number; a: number; b: number };

function lab(hex: string): Lab {
  const o = hexToOklch(hex);
  const h = (o.h * Math.PI) / 180;
  return { L: o.l, a: o.c * Math.cos(h), b: o.c * Math.sin(h) };
}

const REFS = TABLE.map(([name, hex]) => ({ name, lab: lab(hex) }));

/** "deep green" for #1f4a33; "colour" for anything that isn't #rrggbb. */
export function nearestColourName(hex: string): string {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return "colour";
  const p = lab(hex.toLowerCase());
  let best = REFS[0]!;
  let bestD = Infinity;
  for (const r of REFS) {
    const d =
      (p.L - r.lab.L) ** 2 + (p.a - r.lab.a) ** 2 + (p.b - r.lab.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best.name;
}

/** The strip's aria-label: "Colours from your mood board: deep green, cream, rust". */
export function paletteLabel(swatches: readonly { hex: string }[]): string {
  const names = swatches.map((s) => nearestColourName(s.hex));
  return `Colours from your mood board: ${names.join(", ")}`;
}
