// PaletteStrip: the mood board's signature element (06-21; 06-UI-SPEC "Mood board" item 2,
// Accessibility "PaletteStrip", Motion; ONB-05, D47, D-UI-P6-28). A 48px strip of up to 6
// swatches whose widths follow each colour's weight (min 24px), a 1px --hub-border-strong
// outline, 4px radius on the outer ends only, and each hex under its swatch (hidden below
// 480px; it stays in `title` and in the roles list). The swatch fills are data colours, set
// inline from validated #rrggbb values; everything else reads hub tokens. One image to
// assistive tech: the caller passes the spoken label ("Colours from your mood board: deep
// green, cream, …") because @cds/ui carries no colour-name table.
// Widths ease over 200ms when the palette changes; no transition under reduced motion.

const HEX = /^#[0-9a-f]{6}$/i;
export const PALETTE_STRIP_MAX = 6;

export interface PaletteStripProps {
  swatches: readonly { hex: string; weight: number }[];
  label: string;
}

/** The swatches the strip draws: valid hex only, weights floored at 1, at most 6. */
export function stripSwatches(
  swatches: PaletteStripProps["swatches"],
): { hex: string; weight: number }[] {
  return swatches
    .filter((s) => typeof s.hex === "string" && HEX.test(s.hex))
    .slice(0, PALETTE_STRIP_MAX)
    .map((s) => ({
      hex: s.hex.toLowerCase(),
      weight:
        typeof s.weight === "number" &&
        Number.isFinite(s.weight) &&
        s.weight > 0
          ? s.weight
          : 1,
    }));
}

export function PaletteStrip({ swatches, label }: PaletteStripProps) {
  const list = stripSwatches(swatches);
  if (list.length === 0) return null;
  const segment = (weight: number) => ({
    flexGrow: weight,
    flexShrink: 1,
    flexBasis: 0,
  });
  return (
    <div
      role="img"
      aria-label={label}
      data-palette-strip=""
      className="flex w-full flex-col gap-1 font-hub"
    >
      <div className="flex h-12 w-full overflow-hidden rounded outline outline-1 outline-hub-border-strong">
        {list.map((s, i) => (
          <div
            key={`${s.hex}-${i}`}
            data-swatch={s.hex}
            title={s.hex}
            className="h-full min-w-6 transition-[flex-grow] duration-200 motion-reduce:transition-none"
            style={{ ...segment(s.weight), backgroundColor: s.hex }}
          />
        ))}
      </div>
      <div aria-hidden="true" className="hidden w-full min-[480px]:flex">
        {list.map((s, i) => (
          <span
            key={`${s.hex}-${i}`}
            className="min-w-6 truncate text-sm text-hub-ink-muted tabular-nums transition-[flex-grow] duration-200 motion-reduce:transition-none"
            style={segment(s.weight)}
          >
            {s.hex}
          </span>
        ))}
      </div>
    </div>
  );
}
