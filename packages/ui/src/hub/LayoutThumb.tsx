// LayoutThumb, the hub's signature element (03-UI-SPEC "Signature element: LayoutThumb";
// invariant 6: layout belongs to the container). A drawn schematic of a row layout, never
// an image: COLUMN_COUNT bars whose flex-grow values are the layout's own ratios
// ("25-75" -> 25 and 75, "full" -> 100), 4px gaps, radius 2px, ink-muted at 35% at rest and
// the accent when selected. 48x32 (layout picker, preset tiles) or 24x16 (row chip).
// Server-safe: no hooks, no client code.
import { COLUMN_COUNT, type RowLayout } from "@cds/core/content";

export interface LayoutThumbProps {
  layout: RowLayout;
  size?: "md" | "sm";
  selected?: boolean;
  /** Rendered visibly under the thumb ("25/75"); otherwise the thumb is role=img. */
  label?: string;
}

const DIMENSIONS = {
  md: { width: 48, height: 32, gap: 4 },
  sm: { width: 24, height: 16, gap: 2 },
} as const;

/** The column ratios encoded in a layout id. */
export function layoutRatios(layout: RowLayout): number[] {
  const ratios =
    layout === "full" ? [100] : layout.split("-").map((n) => Number(n));
  // COLUMN_COUNT is the authority on how many columns a layout draws (03-02); a ratio
  // list that disagrees would be a new layout id added without its bars.
  const count = COLUMN_COUNT[layout] ?? 1;
  return ratios.length === count
    ? ratios
    : Array.from({ length: count }, () => 1);
}

/** "25-75" -> "25/75 layout"; "full" -> "Full width layout". */
export function layoutName(layout: RowLayout): string {
  return layout === "full" ? "Full width" : layout.split("-").join("/");
}

export function LayoutThumb({
  layout,
  size = "md",
  selected = false,
  label,
}: LayoutThumbProps) {
  const { width, height, gap } = DIMENSIONS[size];
  const bars = (
    <span
      role={label ? undefined : "img"}
      aria-label={label ? undefined : `${layoutName(layout)} layout`}
      aria-hidden={label ? true : undefined}
      data-layout={layout}
      className="inline-flex shrink-0"
      style={{ width: `${width}px`, height: `${height}px`, gap: `${gap}px` }}
    >
      {layoutRatios(layout).map((ratio, i) => (
        <span
          key={i}
          data-layout-bar=""
          className={`block h-full rounded-[2px] transition-colors duration-150 ${
            selected ? "bg-hub-accent" : "bg-hub-ink-muted/35"
          }`}
          style={{ flexGrow: ratio, flexShrink: 1, flexBasis: 0 }}
        />
      ))}
    </span>
  );

  if (!label) return bars;
  return (
    <span className="inline-flex flex-col items-center gap-1 font-hub">
      {bars}
      <span
        className={`text-sm tabular-nums ${selected ? "font-semibold text-hub-ink" : "text-hub-ink-muted"}`}
      >
        {label}
      </span>
    </span>
  );
}
