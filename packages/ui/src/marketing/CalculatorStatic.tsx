// Owner: 15-12 (P15-P1). CalculatorStatic: the no-JS calculator (15-UI-SPEC "Calculator" No JS; HUB-06,
// D296, D-UI-P15-16..18). A <noscript> block: a style rule hides the island's wrapper (the /start pattern)
// and a <table> computed with compareCosts(CALC_DEFAULTS) shows the same two columns, so no dead inputs show.
// Also the shared, server-safe calculator helpers (formatting, rows, availability) the client island
// imports: a "use client" module can import from here, never the other way round.
import {
  CALC_DEFAULTS,
  MK_COPY,
  calcGatewayFeesLabel,
  calcProcessingLabel,
  calcStaticCaption,
  compareCosts,
  type Claim,
  type CompareResult,
  type CentsRange,
} from "@cds/core/marketing";
import { PRICE_SOON } from "@cds/core/pricing";
import { FootnoteRef } from "./ClaimFootnotes";
import {
  GatewayBand,
  comparisonAnchors,
  comparisonRows,
  footnoteOrder,
} from "./ComparisonTable";

/** The island wrapper the no-JS style hides. */
export const CALC_ISLAND_ID = "mk-calculator-island";

/** Every claim compareCosts() reads (P15-P16); the calculator hides unless all are visible. */
export const CALC_CLAIM_IDS = [
  "mindbody-online",
  "boulevard-online",
  "fresha-marketplace",
  "booksy-boost",
  "vagaro-stack",
  "stripe-online",
] as const;

export type CalcPath = "standard" | "studio";
export type PlanMonthlyCents = Record<CalcPath, number | null>;

/** Hidden when the comparison is hidden or any rate claim is not visible (UI-SPEC "Hidden when"). */
export function calculatorAvailable(claims: readonly Claim[]): boolean {
  const ids = new Set(claims.map((c) => c.id));
  return (
    comparisonRows(claims).length > 0 &&
    CALC_CLAIM_IDS.every((id) => ids.has(id))
  );
}

/**
 * Ids whose `ref-<id>` anchor the calculator owns: claims the comparison section does not show
 * (the Mindbody / Boulevard rates). The no-JS table always carries them; the island only once
 * mounted, so without JS "Back to text" never points into the hidden island (WR-C06).
 */
export function calcAnchors(claims: readonly Claim[]): Set<string> {
  const owned = comparisonAnchors(claims);
  return new Set(claims.map((c) => c.id).filter((id) => !owned.has(id)));
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Whole-dollar currency from cents. */
export function calcMoney(cents: number): string {
  return USD.format(cents / 100);
}

/** "$A to $B"; equal ends (after rounding) give one figure. */
export function calcRange(r: CentsRange): string {
  const lo = calcMoney(r.lo);
  const hi = calcMoney(r.hi);
  return lo === hi ? lo : `${lo} to ${hi}`;
}

const RATE_IN_TEXT = /\d+(?:\.\d+)?% \+ \d+¢/;

/** The rate as the claim writes it ("3.60% + 30¢"); falls back to the structured rate. */
export function claimRateText(claim: Claim): string {
  const m = RATE_IN_TEXT.exec(claim.text);
  if (m) return m[0];
  const r = claim.rate;
  return r ? `${r.pct}% + ${r.fixedCents}¢` : claim.figure;
}

export type CalcLine = {
  key: string;
  label: string;
  refs: readonly string[];
  value: string;
};

export type CalcView = {
  elsewhere: CalcLine[];
  elsewhereKeeps: string;
  cds: CalcLine[];
  cdsKeeps: string;
  /** For the bars: upper bound elsewhere and the CDS total (null while the plan is coming soon). */
  barElsewhere: number;
  barCds: number | null;
};

/** The output lines for a result. "Platform cut" sits directly above the gateway fees line (D296). */
export function calcView(
  result: CompareResult,
  claims: readonly Claim[],
): CalcView {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const rate = (id: string) => {
    const c = byId.get(id);
    return c ? claimRateText(c) : "";
  };
  const K = MK_COPY.CALC;
  const e = result.elsewhere;
  const elsewhere: CalcLine[] = [
    {
      key: "processing",
      label: calcProcessingLabel(
        rate("mindbody-online"),
        rate("boulevard-online"),
      ),
      refs: ["mindbody-online", "boulevard-online"],
      value: calcRange(e.processing),
    },
  ];
  if (e.marketplace)
    elsewhere.push({
      key: "marketplace",
      label: K.MARKETPLACE,
      refs: ["fresha-marketplace", "booksy-boost"],
      value: calcRange(e.marketplace),
    });
  elsewhere.push({
    key: "stack",
    label: K.STACK,
    refs: ["vagaro-stack"],
    value: calcMoney(e.stack),
  });
  const plan = result.cds.planCents;
  const cds: CalcLine[] = [
    {
      key: "cut",
      label: K.PLATFORM_CUT,
      refs: [],
      value: calcMoney(result.cds.platformCutCents),
    },
    {
      key: "gateway",
      label: calcGatewayFeesLabel(rate("stripe-online")),
      refs: ["stripe-online"],
      value: calcMoney(result.cds.gatewayCents),
    },
    {
      key: "plan",
      label: K.PLAN,
      refs: [],
      value: plan === null ? PRICE_SOON : calcMoney(plan),
    },
  ];
  return {
    elsewhere,
    elsewhereKeeps: calcRange(e.total),
    cds,
    cdsKeeps:
      result.cds.total === null ? PRICE_SOON : calcMoney(result.cds.total),
    barElsewhere: e.total.hi,
    // never drawn as a zero bar while the plan is unpriced (D296, WR-C01): the bar is hidden instead
    barCds: result.cds.total,
  };
}

/** A line label followed by its footnote refs; only ids in `anchors` carry `ref-<id>` (calcAnchors). */
export function CalcLabel({
  line,
  order,
  anchors,
}: {
  line: CalcLine;
  order: readonly string[];
  anchors?: ReadonlySet<string>;
}) {
  return (
    <>
      {line.label}
      {line.refs.map((id) => (
        <FootnoteRef
          key={id}
          claimId={id}
          order={order}
          anchor={anchors ? anchors.has(id) : false}
        />
      ))}
    </>
  );
}

export type CalculatorStaticProps = {
  claims: readonly Claim[];
  planMonthlyCents: PlanMonthlyCents;
  path: CalcPath;
  order?: readonly string[];
};

const ROW_TH =
  "px-3 py-2 text-left align-top text-[18px] leading-[1.55] font-normal";
const ROW_TD =
  "mk-figures px-3 py-2 text-right align-top text-[18px] leading-[1.55] whitespace-nowrap";

export function CalculatorStatic({
  claims,
  planMonthlyCents,
  path,
  order,
}: CalculatorStaticProps) {
  if (!calculatorAvailable(claims)) return null;
  const refs = order ?? footnoteOrder(claims);
  // Noscript content is not in the DOM when JS runs, so these ids never clash with the island.
  const anchors = calcAnchors(claims);
  const view = calcView(
    compareCosts({
      ...CALC_DEFAULTS,
      planMonthlyCents: planMonthlyCents[path],
      claims,
    }),
    claims,
  );
  const K = MK_COPY.CALC;
  const group = (
    title: string,
    tint: string,
    lines: CalcLine[],
    keeps: string,
  ) => (
    <tbody className={tint}>
      <tr>
        <th
          colSpan={2}
          scope="colgroup"
          className="px-3 pt-4 pb-2 text-left text-[22px] leading-[1.3] font-bold"
        >
          {title}
        </th>
      </tr>
      {lines.map((l) => (
        <tr key={l.key} data-calc-line={l.key}>
          <th scope="row" className={ROW_TH}>
            <CalcLabel line={l} order={refs} anchors={anchors} />
          </th>
          <td className={ROW_TD}>{l.value}</td>
        </tr>
      ))}
      <tr data-calc-line="keeps">
        <th scope="row" className={`${ROW_TH} font-bold`}>
          {K.KEEPS}
        </th>
        <td className={`${ROW_TD} font-bold`}>{keeps}</td>
      </tr>
    </tbody>
  );
  return (
    <noscript>
      <style>{`#${CALC_ISLAND_ID}{display:none}`}</style>
      <div className="mx-auto flex max-w-[1040px] flex-col gap-6">
        <h2 className="m-0 font-mk-display text-[clamp(32px,4vw,48px)] leading-[1.05] font-bold text-mk-fg">
          {K.H2}
        </h2>
        <table className="w-full max-w-[640px] border-collapse text-mk-ink">
          <caption className="mb-3 text-left text-[18px] leading-[1.55] text-mk-fg">
            {calcStaticCaption(
              calcMoney(CALC_DEFAULTS.salesCents),
              calcMoney(CALC_DEFAULTS.avgCents),
            )}
          </caption>
          {group(
            K.ELSEWHERE,
            "bg-mk-tangerine-tint",
            view.elsewhere,
            view.elsewhereKeeps,
          )}
          {group(K.WITH_CDS, "bg-mk-leaf-tint", view.cds, view.cdsKeeps)}
        </table>
        <GatewayBand
          claims={claims}
          order={refs}
          anchor={false}
          className="max-w-[640px]"
        />
      </div>
    </noscript>
  );
}
