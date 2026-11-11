"use client";

// Owner: 15-12 (P15-P1). CostCalculator: "What would you keep?" (15-UI-SPEC "Calculator"; HUB-06, D296,
// D-UI-P15-16..18, P15-P16). Client island: every valid change recomputes with compareCosts(); an invalid
// field keeps the last valid result and shows its inline error on blur, announced politely. Nothing is saved or sent (no network call).
// "Platform cut" (zero) sits directly above the gateway fees line and the gateway sentence sits under the CDS
// column, never alone. Totals are announced in a polite live region, debounced 500ms. Bars are
// aria-hidden (the numbers carry the meaning). Hidden unless every rate claim is visible.
import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import {
  CALC_DEFAULTS,
  CALC_ERR_AVG,
  CALC_ERR_COUNT,
  CALC_ERR_SALES,
  MK_COPY,
  MK_PATHS,
  calcLiveLine,
  calcLiveLineNoPlan,
  compareCosts,
  inCalcBounds,
  parseCountInput,
  parseMoneyInput,
  type CalcField,
  type Claim,
} from "@cds/core/marketing";
import {
  CALC_ISLAND_ID,
  CalcLabel,
  calcAnchors,
  calcView,
  calculatorAvailable,
  type CalcLine,
  type CalcPath,
  type PlanMonthlyCents,
} from "./CalculatorStatic";
import { GatewayBand, footnoteOrder } from "./ComparisonTable";
import { MkRadioGroup, MkTextField } from "./MkForm";

export type CostCalculatorProps = {
  claims: readonly Claim[];
  planMonthlyCents: PlanMonthlyCents;
  initialPath: CalcPath;
  /** The page's footnote order; defaults to footnoteOrder(claims). */
  order?: readonly string[];
};

/** Live-region debounce (UI-SPEC "Live region"). */
export const CALC_LIVE_DEBOUNCE_MS = 500;

type Values = Record<CalcField, number>;
type Raw = Record<CalcField, string>;
type Errors = Partial<Record<CalcField, string>>;

const ERR: Record<CalcField, string> = {
  salesCents: CALC_ERR_SALES,
  avgCents: CALC_ERR_AVG,
  appClients: CALC_ERR_COUNT,
};

function parseField(field: CalcField, raw: string): number | null {
  const v =
    field === "appClients" ? parseCountInput(raw) : parseMoneyInput(raw);
  return v !== null && inCalcBounds(field, v) ? v : null;
}

const asDollars = (cents: number) => String(cents / 100);

/** Before mount the island carries no `ref-` anchors (WR-C06). */
const NO_ANCHORS: ReadonlySet<string> = new Set();

const PATH_OPTIONS = (["standard", "studio"] as const).map((k) => ({
  value: k,
  label: MK_PATHS[k].name,
}));

function Panel({
  title,
  tone,
  lines,
  keeps,
  order,
  anchors,
}: {
  title: string;
  tone: "elsewhere" | "cds";
  lines: CalcLine[];
  keeps: string;
  order: readonly string[];
  anchors: ReadonlySet<string>;
}) {
  const ground =
    tone === "elsewhere"
      ? "border-mk-tangerine bg-mk-tangerine-tint"
      : "border-mk-leaf bg-mk-leaf-tint";
  return (
    <div className={`flex flex-col gap-3 border-t-4 p-6 text-mk-ink ${ground}`}>
      <h3 className="m-0 text-[22px] leading-[1.3] font-bold">{title}</h3>
      <dl className="m-0 flex flex-col gap-2">
        {lines.map((l) => (
          <div
            key={l.key}
            data-calc-line={l.key}
            className="flex items-baseline justify-between gap-4"
          >
            <dt className="text-[18px] leading-[1.55]">
              <CalcLabel line={l} order={order} anchors={anchors} />
            </dt>
            <dd className="mk-figures m-0 text-right text-[18px] leading-[1.55] whitespace-nowrap">
              {l.value}
            </dd>
          </div>
        ))}
        <div
          data-calc-line="keeps"
          className="flex items-baseline justify-between gap-4 border-t border-mk-ink pt-3"
        >
          <dt className="font-mk-display text-[22px] leading-[1.3] font-bold">
            {MK_COPY.CALC.KEEPS}
          </dt>
          <dd className="mk-figures m-0 text-right text-[22px] leading-[1.3] font-bold whitespace-nowrap">
            {keeps}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function CostCalculator({
  claims,
  planMonthlyCents,
  initialPath,
  order,
}: CostCalculatorProps) {
  const [raw, setRaw] = useState<Raw>({
    salesCents: asDollars(CALC_DEFAULTS.salesCents),
    avgCents: asDollars(CALC_DEFAULTS.avgCents),
    appClients: String(CALC_DEFAULTS.appClients),
  });
  const [valid, setValid] = useState<Values>({ ...CALC_DEFAULTS });
  const [errors, setErrors] = useState<Errors>({});
  const [path, setPath] = useState<CalcPath>(initialPath);
  const [announced, setAnnounced] = useState("");
  // A field that turns invalid on blur is announced here (WR-C02): the totals region keeps the last
  // valid result, so without it a screen-reader user hears nothing when the numbers stop following.
  const [errorAnnounced, setErrorAnnounced] = useState("");
  const available = calculatorAvailable(claims);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const view = useMemo(
    () =>
      available
        ? calcView(
            compareCosts({
              ...valid,
              planMonthlyCents: planMonthlyCents[path],
              claims,
            }),
            claims,
          )
        : null,
    [available, valid, planMonthlyCents, path, claims],
  );

  // An unpriced plan has no CDS total: say so, never "you pay Price coming soon" (WR-C01).
  const live = !view
    ? ""
    : view.barCds === null
      ? calcLiveLineNoPlan(view.elsewhereKeeps)
      : calcLiveLine(view.elsewhereKeeps, view.cdsKeeps);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => setAnnounced(live), CALC_LIVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [live]);

  if (!available || !view) return null;
  const refs = order ?? footnoteOrder(claims);
  // The calculator-only `ref-` anchors appear once mounted: before that (and with no JS) the
  // no-JS table carries them, so "Back to text" never targets the hidden island (WR-C06).
  const anchors = hydrated ? calcAnchors(claims) : NO_ANCHORS;
  const K = MK_COPY.CALC;

  // Errors show on blur only (UI-SPEC "On blur"): a partial keystroke ("5000.", a lone "$") never
  // flashes the danger state. A value that parses clears the error at once (WR-C02).
  const onChange = (field: CalcField) => (value: string) => {
    setRaw((r) => ({ ...r, [field]: value }));
    const v = parseField(field, value);
    if (v !== null) {
      setValid((s) => ({ ...s, [field]: v }));
      setErrors((e) => ({ ...e, [field]: undefined }));
      if (errors[field]) setErrorAnnounced("");
    }
  };
  const onBlur = (field: CalcField) => (ev: FocusEvent<HTMLInputElement>) => {
    const v = parseField(field, ev.currentTarget.value);
    if (v === null) {
      setErrors((e) => ({ ...e, [field]: ERR[field] }));
      if (!errors[field]) setErrorAnnounced(ERR[field]);
    } else {
      setErrors((e) => ({ ...e, [field]: undefined }));
    }
  };
  const field = (f: CalcField) => ({
    value: raw[f],
    error: errors[f],
    onChange: (ev: { currentTarget: HTMLInputElement }) =>
      onChange(f)(ev.currentTarget.value),
    onBlur: onBlur(f),
  });

  const max = Math.max(view.barElsewhere, view.barCds ?? 0, 1);
  const bar = (v: number) => `${Math.round((v / max) * 1000) / 10}%`;

  return (
    <div
      id={CALC_ISLAND_ID}
      className="mx-auto flex max-w-[1040px] flex-col gap-8"
    >
      <div className="flex flex-col gap-3">
        <h2
          id="calculator-title"
          className="m-0 font-mk-display text-[clamp(32px,4vw,48px)] leading-[1.05] font-bold text-mk-fg"
        >
          {K.H2}
        </h2>
        <p className="m-0 max-w-[68ch] text-[18px] leading-[1.55] text-mk-fg">
          {K.LEAD}
        </p>
      </div>

      <div className="flex max-w-[640px] flex-col gap-6">
        <MkTextField
          id="calc-sales"
          name="sales"
          label={K.SALES_LABEL}
          help={K.SALES_HELP}
          prefix="$"
          inputMode="decimal"
          autoComplete="off"
          {...field("salesCents")}
        />
        <MkTextField
          id="calc-avg"
          name="average"
          label={K.AVG_LABEL}
          help={K.AVG_HELP}
          prefix="$"
          inputMode="decimal"
          autoComplete="off"
          {...field("avgCents")}
        />
        <MkTextField
          id="calc-clients"
          name="app-clients"
          label={K.COUNT_LABEL}
          help={K.COUNT_HELP}
          inputMode="numeric"
          autoComplete="off"
          {...field("appClients")}
        />
        <MkRadioGroup
          id="calc-path"
          name="path"
          legend={K.PATH_LABEL}
          options={PATH_OPTIONS}
          value={path}
          onValueChange={(v) => setPath(v === "studio" ? "studio" : "standard")}
        />
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid gap-6 md:grid-cols-2">
          <Panel
            title={K.ELSEWHERE}
            tone="elsewhere"
            lines={view.elsewhere}
            keeps={view.elsewhereKeeps}
            order={refs}
            anchors={anchors}
          />
          <div className="flex flex-col gap-0">
            <Panel
              title={K.WITH_CDS}
              tone="cds"
              lines={view.cds}
              keeps={view.cdsKeeps}
              order={refs}
              anchors={anchors}
            />
            <GatewayBand claims={claims} order={refs} anchor={false} />
          </div>
        </div>
        <div aria-hidden="true" className="flex flex-col gap-2">
          <span
            data-calc-bar="elsewhere"
            className="block h-3 rounded-mk-round bg-mk-tangerine transition-[width] duration-[var(--mk-dur-lift)] ease-[var(--mk-ease-out)]"
            style={{ width: bar(view.barElsewhere) }}
          />
          {view.barCds === null ? null : (
            <span
              data-calc-bar="cds"
              className="block h-3 rounded-mk-round bg-mk-leaf transition-[width] duration-[var(--mk-dur-lift)] ease-[var(--mk-ease-out)]"
              style={{ width: bar(view.barCds) }}
            />
          )}
        </div>
        <p aria-live="polite" className="sr-only" data-calc-live="">
          {announced}
        </p>
        <p aria-live="polite" className="sr-only" data-calc-error-live="">
          {errorAnnounced}
        </p>
      </div>
    </div>
  );
}
