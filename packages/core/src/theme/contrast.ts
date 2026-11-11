// The one WCAG 2.2 contrast implementation (THEME-05, CONTEXT A3-Q4). Lifted from
// tests/tokens-contrast.test.ts (that test switches to it in a later 04 plan). sRGB threshold 0.04045 (WCAG errata).
// Accepts only #rrggbb; anything else throws InvalidInput (T-04-03). Pure and Edge-safe.
import { InvalidInput } from "../errors";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** WCAG relative luminance of a `#rrggbb` colour, 0..1. */
export function relativeLuminance(hex: string): number {
  if (typeof hex !== "string" || !HEX6.test(hex)) {
    throw new InvalidInput("colour must be #rrggbb");
  }
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#rrggbb` colours, 1..21. Argument order does not matter. */
export function contrastRatio(a: string, b: string): number {
  return contrastFromLuminance(relativeLuminance(a), relativeLuminance(b));
}

/** WCAG contrast ratio of two relative luminances (for callers that cache luminance). */
export function contrastFromLuminance(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
