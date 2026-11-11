// Owner: 15-10 (P15-P1). BladeDeck: the fanned deck (UI-SPEC "Signature interaction", "BladeDeck
// contents", "Accessibility contract"; D-UI-P15-9, D-UI-P15-11).
// - A semantic <ul aria-label="Paths and add-ons"> of at most 9 blades in DOM order (= visual
//   left-to-right); each available blade is one link named "<Name>, <price run>"; coming-soon
//   blades are list text, never focusable. Rotation is presentational only.
// - Fan only on (min-width: 1024px) and (pointer: fine) (the wide 560px fan from 1440px, 15-26);
//   elsewhere the same list renders as the
//   closed deck (64px rows, first 5 + "See all add-ons"). Fewer than 5 blades: rows at all widths.
// - The lift is CSS only: hovering or focusing a blade straightens it and raises it 24px; its
//   neighbours spread 3deg. The default lifted blade (Standard) stands up while nothing is hovered
//   or focused. Durations are the --mk-dur-* tokens, which tokens.css zeroes under
//   prefers-reduced-motion (and the rule below repeats it), so the lift is instant there.
// The stylesheet is a constant scoped to [data-mk-deck]; it is unlayered, so it beats the
// Tailwind utilities on the same elements. No colour literals: every colour is a --mk-* var.
// The blade box is a white card, so it resets the field text vars (--mk-fg / --mk-muted) to ink:
// a deck inside a cobalt or berry field would otherwise draw the Coming soon tag white on white
// (CR-C01). --mk-focus is left to the field, so the focus ring keeps its contrast on the ground.
import Link from "next/link";
import type { CSSProperties } from "react";
import { MK_COPY } from "@cds/core/marketing";
import { Blade, type BladeData } from "./Blade";

export const DECK_MAX = 9;
const FAN_MIN = 5;

/**
 * Blade angles (deg) for an n-blade fan: step clamp(6, 72 / (n - 1), 14), symmetric about 0,
 * pivoting at the rivet.
 */
export function fanAngles(n: number): number[] {
  if (n <= 1) return n === 1 ? [0] : [];
  const step = Math.min(14, Math.max(6, 72 / (n - 1)));
  const start = (-step * (n - 1)) / 2;
  return Array.from(
    { length: n },
    (_, i) => Math.round((start + i * step) * 100) / 100,
  );
}

const ACTIVE = "li:is(:hover, :focus-within)";
const FAN = '[data-mk-deck="fan"]';
const IDLE = `${FAN}:not(:has(> ${ACTIVE}))`;

const DECK_CSS = `
[data-mk-deck] { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--mk-space-2); }
[data-mk-deck] > li { position: relative; }
[data-mk-deck] [data-mk-blade-box] {
  --mk-fg: var(--mk-ink); --mk-muted: var(--mk-ink-muted);
  position: relative; display: flex; align-items: stretch; min-height: 64px;
  border: 1px solid var(--mk-rule); border-radius: var(--mk-radius-blade); overflow: hidden;
  background: var(--mk-card); color: var(--mk-ink); text-decoration: none;
  transition: transform var(--mk-dur-fast) var(--mk-ease-out), box-shadow var(--mk-dur-fast) var(--mk-ease-out);
}
[data-mk-deck] a[data-mk-blade-box] { min-height: 64px; }
[data-mk-deck] a[data-mk-blade-box]:hover { border-color: var(--mk-ink); }
[data-mk-deck] a[data-mk-blade-box]:active { transform: translateY(-4px); box-shadow: var(--mk-shadow-lift); }
[data-mk-deck] [data-mk-chip] {
  flex: 0 0 72px; display: flex; align-items: center; justify-content: center;
  color: var(--mk-fg);
}
[data-mk-deck] [data-mk-chip-outline] { border: 2px solid; border-radius: var(--mk-radius-blade) 0 0 var(--mk-radius-blade); }
[data-mk-deck] [data-mk-body] {
  display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0;
  padding: var(--mk-space-2) var(--mk-space-4);
}
[data-mk-deck] [data-mk-num] { color: var(--mk-ink-muted); }
${FAN} > li:nth-child(n + 6) { display: none; }
[data-mk-deck-more] { display: inline-flex; align-items: center; min-height: 44px; margin-top: var(--mk-space-2); }
@media (min-width: 1024px) {
  [data-mk-deck="rows"] { max-width: 560px; }
}
@media (min-width: 1024px) and (pointer: fine) {
  [data-mk-deck-wrap="fan"] [data-mk-deck-more] { display: none; }
  ${FAN} { display: block; position: relative; width: 480px; height: 424px; margin-inline: auto; }
  ${FAN} > li, ${FAN} > li:nth-child(n + 6) {
    display: block; position: absolute; bottom: 16px; left: calc(50% - 56px); width: 112px; height: 352px;
    transform-origin: 50% calc(100% - 24px);
    transform: translateY(0) rotate(calc(var(--mk-a) + var(--mk-spread, 0deg)));
    transition: transform var(--mk-dur-spread) var(--mk-ease-out);
  }
  ${FAN} [data-mk-blade-box] {
    flex-direction: column; height: 100%; border-color: var(--mk-rule); box-shadow: var(--mk-shadow-rest);
    transition: box-shadow var(--mk-dur-lift) var(--mk-ease-out);
  }
  ${FAN} a[data-mk-blade-box]:active { transform: none; }
  ${FAN} [data-mk-chip] { flex: 0 0 45%; }
  ${FAN} [data-mk-chip-outline] { border-radius: var(--mk-radius-blade) var(--mk-radius-blade) 0 0; }
  ${FAN} [data-mk-chip] > [aria-hidden] {
    position: absolute; left: calc(50% - 6px); bottom: 18px; color: var(--mk-rule-strong);
  }
  ${FAN} [data-mk-body] { justify-content: flex-start; padding: var(--mk-space-2) var(--mk-space-2) 48px; }
  ${FAN} [data-mk-run] { opacity: 0; transition: opacity var(--mk-dur-fast) linear; }
  ${FAN} > ${ACTIVE}, ${IDLE} > li[data-mk-lifted] {
    z-index: 20; transform: translateY(-24px) rotate(0deg);
    transition: transform var(--mk-dur-lift) var(--mk-ease-out);
  }
  ${FAN} > ${ACTIVE} [data-mk-blade-box], ${IDLE} > li[data-mk-lifted] [data-mk-blade-box] { box-shadow: var(--mk-shadow-lift); }
  ${FAN} > ${ACTIVE} [data-mk-run], ${IDLE} > li[data-mk-lifted] [data-mk-run] { opacity: 1; }
  ${FAN} > li:has(~ ${ACTIVE}), ${IDLE} > li:has(~ li[data-mk-lifted]) { --mk-spread: -3deg; }
  ${FAN} > ${ACTIVE} ~ li, ${IDLE} > li[data-mk-lifted] ~ li { --mk-spread: 3deg; }
}
@media (min-width: 1440px) and (pointer: fine) {
  ${FAN} { width: 560px; height: 480px; }
  ${FAN} > li, ${FAN} > li:nth-child(n + 6) { left: calc(50% - 64px); width: 128px; height: 400px; }
}
@media (prefers-reduced-motion: reduce) {
  [data-mk-deck] > li, [data-mk-deck] [data-mk-blade-box], [data-mk-deck] [data-mk-run] { transition: none !important; }
}
`;

export type BladeDeckProps = {
  blades: readonly BladeData[];
  /** The blade standing up while nothing is hovered or focused. */
  liftedKey?: string;
  className?: string;
};

export function BladeDeck({
  blades,
  liftedKey = "standard",
  className,
}: BladeDeckProps) {
  const shown = blades.slice(0, DECK_MAX);
  const mode = shown.length >= FAN_MIN ? "fan" : "rows";
  const angles = fanAngles(shown.length);
  return (
    <div data-mk-deck-wrap={mode} className={className}>
      <style>{DECK_CSS}</style>
      <ul aria-label={MK_COPY.HOME.DECK_LABEL} data-mk-deck={mode}>
        {shown.map((b, i) => (
          <li
            key={b.key}
            data-mk-lifted={b.key === liftedKey ? "" : undefined}
            style={{ "--mk-a": `${angles[i] ?? 0}deg` } as CSSProperties}
          >
            <Blade data={b} orientation={mode === "fan" ? "fan" : "row"} />
          </li>
        ))}
      </ul>
      <Link href="/add-ons" data-mk-deck-more="">
        {MK_COPY.HOME.SEE_ALL_ADDONS}
      </Link>
    </div>
  );
}
