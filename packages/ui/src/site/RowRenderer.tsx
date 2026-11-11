// Row renderer: band + container + grid per layout (CONT-03, CONT-04, D31; invariants 6
// and 7; 03-UI-SPEC "Site rendering contract / RowRenderer").
//
// Ported from donor src/components/sections/RowRenderer.tsx. The layoutClasses table is
// the CONT-03 grid contract and is kept verbatim (breakpoints: 2- and 3-column layouts
// split at md/768px; 4 and 5 go 1 -> 2 at sm/640px -> full at md). Everything the donor
// read from raw section settings (colours, padding choice, width, extra classes) is
// removed: tenants build within the theme (invariant 7), so the only input is which band
// the row sits in. Server component: no hooks, no next/* imports.
import type { ReactNode } from "react";
import type { BackgroundVariant, RowLayout } from "@cds/core/content";

export interface RowRendererProps {
  layout: RowLayout;
  background: BackgroundVariant;
  children?: ReactNode;
}

const layoutClasses: Record<RowLayout, string> = {
  full: "",
  "50-50": "grid grid-cols-1 md:grid-cols-2 gap-8",
  "25-75": "grid grid-cols-1 md:grid-cols-[1fr_3fr] gap-8",
  "75-25": "grid grid-cols-1 md:grid-cols-[3fr_1fr] gap-8",
  "40-60": "grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-8",
  "60-40": "grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-8",
  "30-70": "grid grid-cols-1 md:grid-cols-[3fr_7fr] gap-8",
  "70-30": "grid grid-cols-1 md:grid-cols-[7fr_3fr] gap-8",
  "33-33-33": "grid grid-cols-1 md:grid-cols-3 gap-8",
  "25-50-25": "grid grid-cols-1 md:grid-cols-[1fr_2fr_1fr] gap-8",
  "25-25-25-25": "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8",
  "20-20-20-20-20": "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-8",
};

/**
 * The grid classes for one row layout (07-20: slides and tab panels are columns rows
 * inside a full-width band). Own-property checked; unknown -> "".
 */
export function rowGridClass(layout: RowLayout): string {
  return Object.prototype.hasOwnProperty.call(layoutClasses, layout)
    ? layoutClasses[layout]
    : "";
}

const BAND: Record<BackgroundVariant, string> = {
  main: "bg-site-surface",
  alternate: "bg-site-surface-raised",
};

export function RowRenderer({
  layout,
  background,
  children,
}: RowRendererProps) {
  const grid = rowGridClass(layout);
  const band = background === "alternate" ? BAND.alternate : BAND.main;
  return (
    // data-band: same-band neighbours share one gap via globals.css (D-UI-P8-6, 08-03).
    <section
      data-band={background === "alternate" ? "alternate" : "main"}
      className={`${band} text-site-text py-12 md:py-16`}
    >
      <div className="mx-auto max-w-[1120px] px-6 md:px-8">
        <div className={grid || undefined}>{children}</div>
      </div>
    </section>
  );
}
