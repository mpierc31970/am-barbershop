// The CDS hub pricing page (15-15; HUB-05, HUB-06; UI-SPEC "Pricing", "Comparison",
// "Calculator"; D180, D264, D296, D299, D300; A2-Q1, A2-Q4). Sections in UI-SPEC order:
// first viewport (card) -> plans (stock) -> add-on prices (card) -> Care Plan (card) ->
// worked examples (stock) -> comparison (card) -> calculator (stock) -> Good to know (card)
// -> sources (marigold) -> closing CTA (ink).
// - Every figure comes from the catalog through the shared @cds/core/pricing helpers (D264):
//   no money is computed or written here beyond `monthly × 10` for the yearly line (D180,
//   2 months free). A failed catalog read prints no figures; unset prices read
//   "Price coming soon".
// - Claims are visibleClaims(CLAIMS, isProductionHub()) per request (T-15-15-02): production
//   shows verified claims only, and the comparison, calculator and sources hide entirely
//   when none remain. The gateway sentence renders with the comparison (D296, T-15-15-03).
// - Dynamic per request, no ISR (P15-P3).
import {
  addonChip,
  CLAIMS,
  exampleTotal,
  EXAMPLES,
  MK_COPY,
  MK_PATHS,
  PATH_CHIPS,
  SHOP_SOON,
  visibleClaims,
  type MkPathKey,
} from "@cds/core/marketing";
import {
  catalogRow,
  formatCents,
  formatMonthly,
  formatYearly,
  PRICE_SOON,
  priceLabelFor,
  type CatalogRow,
} from "@cds/core/pricing";
import {
  CalculatorStatic,
  calculatorAvailable,
  ChipField,
  ClaimFootnotes,
  ComingSoonTag,
  ComparisonTable,
  comparisonRows,
  CostCalculator,
  footnoteOrder,
  FormulaCard,
  MkLinkButton,
  PriceRun,
  RivetMark,
  SourcesTable,
  type BladeChip,
  type FormulaExample,
  type PlanMonthlyCents,
} from "@cds/ui/marketing";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  hubCanonical,
  hubRobots,
  isProductionHub,
} from "../../../../lib/hub-env";
import {
  addonPriceLines,
  marketingCatalog,
} from "../../../../lib/marketing-catalog";

export const dynamic = "force-dynamic";

const PATHS: readonly MkPathKey[] = ["standard", "studio"];
/** D180: pay yearly, get 2 months free = 10 monthly payments. */
const YEARLY_MONTHS = 10;
/** price_catalog Care Plan rows: kind `care_plan`, key `care`, one per path (pricing/types.ts). */
const CARE_KIND = "care_plan";
const CARE_KEY = "care";

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const H2 =
  "m-0 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]";
const HEADING_FIG =
  "mk-figures m-0 text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold";
const BODY = "m-0 text-[18px] leading-[1.55] [text-wrap:pretty]";
const LABEL = "text-[14px] leading-[1.4] font-bold";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.PRICING_TITLE,
    description: MK_COPY.PRICING.LEAD,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/pricing") },
  };
}

type PlanFigures = {
  monthly: string;
  build: string;
  /** The computed yearly figure, only when the monthly is priced (D180). */
  yearly: string | null;
};

function planFigures(
  catalog: readonly CatalogRow[],
  path: MkPathKey,
): PlanFigures {
  const monthlyCents = catalogRow(catalog, "plan", "base", path)?.monthlyCents;
  const buildCents = catalogRow(
    catalog,
    "build_fee",
    "base",
    path,
  )?.oneTimeCents;
  return {
    monthly: monthlyCents == null ? PRICE_SOON : formatMonthly(monthlyCents),
    build:
      buildCents == null
        ? PRICE_SOON
        : `${formatCents(buildCents)} ${MK_COPY.PRICING.BUILD_FEE_SUFFIX}`,
    yearly:
      monthlyCents == null ? null : formatYearly(monthlyCents * YEARLY_MONTHS),
  };
}

/** Strip the "<Path> · " prefix from an addonPriceLines() line: the table column names the path. */
function cellLabel(line: string | undefined, path: MkPathKey): string {
  if (line === undefined) return PRICE_SOON;
  const prefix = `${MK_PATHS[path].name} · `;
  return line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

function Dot({ chip }: { chip: BladeChip }) {
  if (chip === "outline") {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-3 shrink-0 rounded-mk-round border-2 border-mk-ink"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-mk-field={chip}
      className="inline-block size-3 shrink-0 rounded-mk-round"
    />
  );
}

function partChip(key: string, order: readonly string[]): BladeChip {
  if (key === "standard" || key === "studio") return PATH_CHIPS[key];
  return addonChip(key, order).chip;
}

export default async function PricingPage() {
  const { catalog, view, publicSlugs } = await marketingCatalog();
  const production = isProductionHub();
  const showDrafts = !production;
  const P = MK_COPY.PRICING;
  const order = view.map((e) => e.slug);

  // Comparison + calculator inputs (HUB-06, A2-Q4).
  const claims = visibleClaims(CLAIMS, production);
  const showComparison = comparisonRows(claims).length > 0;
  const showCalculator = showComparison && calculatorAvailable(claims);
  const refs = footnoteOrder(claims);
  const planCents: PlanMonthlyCents = {
    standard:
      catalogRow(catalog, "plan", "base", "standard")?.monthlyCents ?? null,
    studio: catalogRow(catalog, "plan", "base", "studio")?.monthlyCents ?? null,
  };

  // Add-on price table rows (listing order).
  const rows = view.map((entry) => {
    const lines = addonPriceLines(entry, catalog);
    return {
      entry,
      chip: addonChip(entry.slug, order).chip,
      cells: PATHS.map((path, i) => ({
        path,
        label: catalog === null ? null : cellLabel(lines[i], path),
      })),
    };
  });

  const careLines =
    catalog === null
      ? []
      : PATHS.map(
          (path) =>
            `${MK_PATHS[path].name} · ${priceLabelFor(
              catalogRow(catalog, CARE_KIND, CARE_KEY, path),
            )}`,
        );

  const examples: FormulaExample[] = EXAMPLES.flatMap((ex) => {
    const total = exampleTotal(ex, catalog, publicSlugs);
    if (total === null) return [];
    return [
      {
        title: ex.title,
        parts: total.parts.map((p) => ({
          name: p.name,
          chip: partChip(p.chipKey, order),
        })),
        total: total.label,
      },
    ];
  });

  return (
    <>
      {/* 1 · First viewport (card) */}
      <ChipField field="card" aria-labelledby="mk-pricing-h1">
        <div
          className={`${WRAP} flex flex-col items-start gap-6 py-12 lg:py-16`}
        >
          <h1
            id="mk-pricing-h1"
            className="m-0 font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]"
          >
            {P.H1}
          </h1>
          <p className={`max-w-[56ch] ${BODY}`}>{P.LEAD}</p>
          <p className="m-0 flex items-center gap-3 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]">
            <RivetMark fill="leaf" />
            <span>{P.PITCH}</span>
          </p>
        </div>
      </ChipField>

      {/* 2 · Plans (stock): two tall path blades, then the Shop outline blade */}
      <ChipField field="stock" aria-label={P.PLANS_LABEL}>
        <div
          className={`${WRAP} grid grid-cols-1 gap-6 py-16 md:grid-cols-2 lg:grid-cols-[1fr_1fr_0.7fr] lg:py-24`}
        >
          {PATHS.map((key) => {
            const path = MK_PATHS[key];
            const figures = catalog === null ? null : planFigures(catalog, key);
            return (
              <article
                key={key}
                data-mk-plan={key}
                aria-labelledby={`mk-plan-${key}`}
                data-mk-field="card"
                className="flex flex-col overflow-hidden rounded-mk-blade border border-mk-ink"
              >
                <div data-mk-field={PATH_CHIPS[key]} className="px-6 py-6">
                  <h2
                    id={`mk-plan-${key}`}
                    className="m-0 font-mk-display text-[clamp(32px,4vw,48px)] leading-[1.05] font-bold"
                  >
                    {path.name}
                  </h2>
                  <p className={`mt-2 ${BODY}`}>{path.whoFor}</p>
                </div>
                <div className="flex flex-1 flex-col gap-6 px-6 py-6">
                  {figures ? (
                    <div className="flex flex-col gap-2">
                      <p className={HEADING_FIG}>{figures.monthly}</p>
                      <p className={`mk-figures ${BODY} font-bold`}>
                        {figures.build}
                      </p>
                      <p className={BODY}>
                        {P.YEARLY}
                        {figures.yearly ? (
                          <>
                            {": "}
                            <span className="mk-figures font-bold">
                              {figures.yearly}
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  ) : null}
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {path.included.map((line) => (
                      <li key={line.text} className="flex items-start gap-3">
                        <Check
                          size={20}
                          aria-hidden="true"
                          className="mt-1 shrink-0"
                        />
                        <span
                          className={`${BODY} flex flex-wrap items-center gap-2`}
                        >
                          {line.text}
                          {line.shipped ? null : <ComingSoonTag />}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto">
                    <MkLinkButton
                      href={path.startHref}
                      variant="primary"
                      size="lg"
                      icon="arrow"
                    >
                      {MK_COPY.PATHS.START[key]}
                    </MkLinkButton>
                  </div>
                </div>
              </article>
            );
          })}
          <article
            aria-labelledby="mk-plan-shop"
            className="flex flex-col items-start gap-4 rounded-mk-blade border-2 border-dashed border-mk-ink p-6 md:col-span-2 lg:col-span-1"
          >
            <h2
              id="mk-plan-shop"
              className="m-0 flex flex-wrap items-center gap-3 font-mk-display text-[32px] leading-[1.05] font-bold"
            >
              {P.SHOP_TITLE}
              <ComingSoonTag />
            </h2>
            <p className={BODY}>{P.SHOP_BODY}</p>
            <MkLinkButton href={SHOP_SOON.askHref} variant="text">
              {P.ASK_SHOP}
            </MkLinkButton>
          </article>
        </div>
      </ChipField>

      {/* 3 · Add-on prices (card): table >= 768px, one <dl> per add-on below */}
      {rows.length > 0 ? (
        <ChipField
          field="card"
          id="add-on-prices"
          aria-labelledby="mk-addon-prices"
          className="scroll-mt-20"
        >
          <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
            <h2 id="mk-addon-prices" className={H2}>
              {P.TABLE_CAPTION}
            </h2>
            <table className="w-full max-w-[1040px] border-collapse max-md:hidden">
              <caption className="sr-only">{P.TABLE_CAPTION}</caption>
              <thead>
                <tr>
                  {P.TABLE_COLUMNS.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className={`border-b-2 border-mk-ink px-4 py-3 text-left ${LABEL}`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ entry, chip, cells }) => (
                  <tr key={entry.slug} className="border-b border-mk-rule">
                    <th scope="row" className="px-4 py-4 text-left align-top">
                      <span className="flex flex-wrap items-center gap-3">
                        <Dot chip={chip} />
                        <Link
                          href={`/add-ons/${encodeURIComponent(entry.slug)}`}
                          className="text-[18px] leading-[1.55] font-bold text-mk-fg underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
                        >
                          {entry.name}
                        </Link>
                        {entry.availability === "available" ? null : (
                          <ComingSoonTag />
                        )}
                      </span>
                    </th>
                    {cells.map((c) => (
                      <td
                        key={c.path}
                        className="mk-figures px-4 py-4 align-top text-[18px] leading-[1.55]"
                      >
                        {c.label}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="m-0 flex list-none flex-col gap-4 p-0 md:hidden">
              {rows.map(({ entry, chip, cells }) => (
                <li
                  key={entry.slug}
                  className="rounded-mk-blade border border-mk-ink p-4"
                >
                  <p className="m-0 flex flex-wrap items-center gap-3">
                    <Dot chip={chip} />
                    <Link
                      href={`/add-ons/${encodeURIComponent(entry.slug)}`}
                      className="text-[18px] leading-[1.55] font-bold text-mk-fg underline decoration-1 underline-offset-[0.2em]"
                    >
                      {entry.name}
                    </Link>
                    {entry.availability === "available" ? null : (
                      <ComingSoonTag />
                    )}
                  </p>
                  {catalog === null ? null : (
                    <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                      {cells.map((c) => (
                        <div key={c.path} className="contents">
                          <dt className={LABEL}>{MK_PATHS[c.path].name}</dt>
                          <dd className="mk-figures m-0 text-[18px] leading-[1.55]">
                            {c.label}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </ChipField>
      ) : null}

      {/* 4 · Care Plan (card) */}
      <ChipField
        field="card"
        id="care-plan"
        aria-labelledby="mk-care-plan"
        className="scroll-mt-20"
      >
        <div
          className={`${WRAP} flex flex-col items-start gap-4 border-t border-mk-rule py-16`}
        >
          <h2 id="mk-care-plan" className={H2}>
            {P.CARE_H2}
          </h2>
          <p className={`max-w-[60ch] ${BODY}`}>{P.CARE_BODY}</p>
          <PriceRun lines={careLines} size="heading" />
          <MkLinkButton href="/start" variant="text">
            {P.CARE_LINK}
          </MkLinkButton>
        </div>
      </ChipField>

      {/* 5 · What it costs, worked out (stock); each example hides on its own */}
      {examples.length > 0 ? (
        <ChipField field="stock" aria-labelledby="mk-pricing-examples">
          <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
            <h2 id="mk-pricing-examples" className={H2}>
              {P.EXAMPLES_H2}
            </h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {examples.map((ex) => (
                <FormulaCard key={ex.title} example={ex} />
              ))}
            </div>
          </div>
        </ChipField>
      ) : null}

      {/* 6 · Comparison (card): hidden entirely when no claim is visible */}
      {showComparison ? (
        <ChipField
          field="card"
          id="how-they-make-their-money"
          aria-labelledby="comparison-title"
          className="scroll-mt-20"
        >
          <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
            <ComparisonTable
              claims={claims}
              showDrafts={showDrafts}
              order={refs}
              className="w-full"
            />
            <ClaimFootnotes
              claims={claims}
              order={refs}
              showDrafts={showDrafts}
              className="mx-auto w-full max-w-[1040px]"
            />
          </div>
        </ChipField>
      ) : null}

      {/* 7 · Calculator (stock): only with the comparison and every rate it needs */}
      {showCalculator ? (
        <ChipField
          field="stock"
          id="calculator"
          aria-labelledby="calculator-title"
          className="scroll-mt-20"
        >
          <div className={`${WRAP} py-16 lg:py-24`}>
            <CostCalculator
              claims={claims}
              planMonthlyCents={planCents}
              initialPath="standard"
              order={refs}
            />
            <CalculatorStatic
              claims={claims}
              planMonthlyCents={planCents}
              path="standard"
              order={refs}
            />
          </div>
        </ChipField>
      ) : null}

      {/* 8 · Good to know (card) */}
      <ChipField field="card" aria-labelledby="mk-pricing-good">
        <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
          <h2 id="mk-pricing-good" className={H2}>
            {P.GOOD_TO_KNOW_H2}
          </h2>
          <dl className="m-0 grid max-w-[1040px] grid-cols-1 gap-6 md:grid-cols-2">
            {P.GOOD_TO_KNOW.map((item) => (
              <div key={item.term} className="flex flex-col gap-1">
                <dt className="text-[18px] leading-[1.55] font-bold">
                  {item.term}
                </dt>
                <dd className={`m-0 ${BODY}`}>
                  {"href" in item ? (
                    <Link
                      href={item.href}
                      className="text-mk-fg underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
                    >
                      {item.detail}
                    </Link>
                  ) : (
                    item.detail
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </ChipField>

      {/* 9 · Sources (marigold band): only with the comparison */}
      {showComparison ? (
        <section
          id="sources"
          aria-labelledby="sources-title"
          className="scroll-mt-20"
        >
          <SourcesTable claims={claims} showDrafts={showDrafts} />
        </section>
      ) : null}

      {/* 10 · Closing CTA (ink) */}
      <ChipField field="ink" aria-labelledby="mk-pricing-close">
        <div
          className={`${WRAP} flex flex-col items-start gap-8 py-16 lg:py-24`}
        >
          <h2 id="mk-pricing-close" className={H2}>
            {P.CLOSING_H2}
          </h2>
          <MkLinkButton href="/start" variant="primary" size="lg" icon="arrow">
            {P.START}
          </MkLinkButton>
        </div>
      </ChipField>
    </>
  );
}
