// Owner: 15-10 (P15-P1). FormulaCard: a worked example as a formula (UI-SPEC "FormulaCard anatomy"):
// chip dot + part name joined by "+", then "=" and the monthly total from the catalog
// (exampleTotal in @cds/core/marketing; "Price coming soon" when any part is unpriced). The visual
// formula is aria-hidden (its "+" / "=" glyphs too); an sr-only sentence reads it instead. No totals
// are computed here, and a null example (hidden by exampleTotal) renders nothing.
import { PRICE_SOON } from "@cds/core/pricing";
import { formulaSentence } from "@cds/core/marketing";
import type { BladeChip } from "./Blade";

export type FormulaPart = { name: string; chip: BladeChip };

export type FormulaExample = {
  /** e.g. "A coach". */
  title: string;
  parts: readonly FormulaPart[];
  /** Catalog-computed label: formatMonthly(sum) or PRICE_SOON. */
  total: string;
  /** Overrides the default sr-only sentence. */
  srSentence?: string;
};

export type FormulaCardProps = {
  example: FormulaExample | null;
  headingLevel?: 2 | 3;
  className?: string;
};

/** "Standard plus Newsletter comes to <total> a month." (or ": Price coming soon."). */
export function formulaSrSentence(
  parts: readonly FormulaPart[],
  total: string,
): string {
  const names = parts.map((p) => p.name);
  if (total === PRICE_SOON) return `${names.join(" plus ")}: ${PRICE_SOON}.`;
  return formulaSentence(names, total.replace(/\/mo$/, " a month"));
}

function Dot({ chip }: { chip: BladeChip }) {
  if (chip === "outline") {
    return (
      <span
        data-mk-dot=""
        className="inline-block size-3 shrink-0 rounded-mk-round border-2 border-mk-ink"
      />
    );
  }
  return (
    <span
      data-mk-dot=""
      data-mk-field={chip}
      className="inline-block size-3 shrink-0 rounded-mk-round"
    />
  );
}

export function FormulaCard({
  example,
  headingLevel = 3,
  className,
}: FormulaCardProps) {
  if (example === null) return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const sentence =
    example.srSentence ?? formulaSrSentence(example.parts, example.total);
  return (
    <div
      data-mk-field="card"
      className={["flex flex-col gap-4 rounded-mk-blade p-6", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Heading className="text-[18px] leading-[1.55] font-bold">
        {example.title}
      </Heading>
      <p
        aria-hidden="true"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[18px] leading-[1.55]"
      >
        {example.parts.map((part, i) => (
          <span key={`${i}-${part.name}`} className="contents">
            {i > 0 ? (
              <span aria-hidden="true" className="text-mk-muted">
                +
              </span>
            ) : null}
            <span className="inline-flex items-center gap-2">
              <Dot chip={part.chip} />
              <span>{part.name}</span>
            </span>
          </span>
        ))}
        <span aria-hidden="true" className="text-mk-muted">
          =
        </span>
        <span className="mk-figures text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold">
          {example.total}
        </span>
      </p>
      <span className="sr-only">{sentence}</span>
    </div>
  );
}
