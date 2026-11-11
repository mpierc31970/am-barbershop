// THEME-05 property test (D47 constraint 1, RESEARCH Pitfalls 3 and 5, T-04-09). Random
// palettes, a quarter of them adversarial (light surface, dark surface-raised), must always
// leave solveContrast with every enforced pair at or above its minimum, measured on the
// returned #rrggbb. A fallback may appear only when no in-hue lightness passes. Seeded PRNG
// (mulberry32), no new dependency, so failures reproduce.
import { describe, expect, it } from "vitest";
import { hexToOklch, oklchToHex, toHex } from "./color";
import { contrastRatio } from "./contrast";
import { ENFORCED_PAIRS, ROLES, type Role, type RoleMap } from "./roles";
import { solveContrast } from "./solver";

const ITERATIONS = 2000;
const SEED = 0x7e3e05;
const FALLBACK_SAMPLES = 400;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHex(rand: () => number): string {
  return toHex({ r: rand() * 255, g: rand() * 255, b: rand() * 255 });
}

function shadeHex(rand: () => number, lo: number, hi: number): string {
  const l = lo + rand() * (hi - lo);
  return oklchToHex({ l, c: rand() * 0.15, h: rand() * 360 });
}

function randomPalette(rand: () => number, iter: number): RoleMap {
  const roles = Object.fromEntries(
    ROLES.map((r) => [r, randomHex(rand)]),
  ) as RoleMap;
  if (iter % 4 === 0) {
    roles.surface = shadeHex(rand, 0.85, 1);
    roles["surface-raised"] = shadeHex(rand, 0.1, 0.45);
  }
  return roles;
}

function passesAll(fgHex: string, fg: Role, roles: RoleMap): boolean {
  return ENFORCED_PAIRS.filter((p) => p.fg === fg).every(
    (p) => contrastRatio(fgHex, roles[p.bg]) >= (p.min ?? 0),
  );
}

describe("solveContrast property (THEME-05)", () => {
  it(`every one of ${ITERATIONS} seeded palettes ends AA on the stored hex`, () => {
    const rand = mulberry32(SEED);
    let adversarial = 0;
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const input = randomPalette(rand, iter);
      if (iter % 4 === 0) adversarial++;
      const out = solveContrast(input);

      for (const p of ENFORCED_PAIRS) {
        const ratio = contrastRatio(out.roles[p.fg], out.roles[p.bg]);
        expect(
          ratio,
          `iter ${iter}: ${p.fg} on ${p.bg} ${JSON.stringify(input)}`,
        ).toBeGreaterThanOrEqual(p.min ?? 0);
      }

      expect(out.roles.surface).toBe(input.surface);
      for (const adj of out.adjustments) {
        expect(adj.to, `iter ${iter}: ${adj.role}`).not.toBe(adj.from);
        expect(adj.to).toMatch(/^#[0-9a-f]{6}$/);
        if (adj.fallback) {
          // No in-hue lightness of the authored colour may pass on the final backgrounds.
          const o = hexToOklch(adj.from);
          for (let i = 0; i <= FALLBACK_SAMPLES; i++) {
            const candidate = oklchToHex({
              l: i / FALLBACK_SAMPLES,
              c: o.c,
              h: o.h,
            });
            expect(
              passesAll(candidate, adj.role, out.roles),
              `iter ${iter}: fallback for ${adj.role} but ${candidate} passes`,
            ).toBe(false);
          }
        }
      }
    }
    expect(adversarial / ITERATIONS).toBeGreaterThanOrEqual(0.2);
  }, 120_000);
});
