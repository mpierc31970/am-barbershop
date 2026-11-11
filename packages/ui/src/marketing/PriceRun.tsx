// Owner: 15-10 (P15-P1). PriceRun: per-path price lines ("Standard · <monthly>", "Studio · Included",
// "Studio · Not on this path", "Price coming soon"), one per line, tabular (P15-P10 .mk-figures).
// It prints only the strings it is given: callers build them with the shared @cds/core/pricing
// label helpers (D264, HUB-05, T-15-10-02). It never formats a number itself.
import { Minus } from "lucide-react";
import { MK_COPY } from "@cds/core/marketing";

export type PriceRunProps = {
  lines: readonly string[];
  /** label = 14px (blades, rows); heading = Heading size (add-on detail first viewport). */
  size?: "label" | "heading";
  className?: string;
};

const NOT_ON = MK_COPY.ADDONS.NOT_ON_PATH;

const SIZE = {
  label: "text-[14px] leading-[1.4] font-bold",
  heading: "text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold",
} as const;

function Line({ line }: { line: string }) {
  if (line.endsWith(NOT_ON)) {
    const prefix = line.slice(0, line.length - NOT_ON.length);
    return (
      <span data-mk-run-line="" className="flex items-center gap-1">
        {prefix}
        <Minus size={20} aria-hidden="true" className="shrink-0" />
        {NOT_ON}
      </span>
    );
  }
  return (
    <span data-mk-run-line="" className="block">
      {line}
    </span>
  );
}

export function PriceRun({ lines, size = "label", className }: PriceRunProps) {
  if (lines.length === 0) return null;
  return (
    <span
      data-mk-run=""
      className={["mk-figures flex flex-col", SIZE[size], className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {lines.map((line, i) => (
        <Line key={`${i}-${line}`} line={line} />
      ))}
    </span>
  );
}
