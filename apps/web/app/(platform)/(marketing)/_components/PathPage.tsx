// The shared Standard / Studio path page (15-16; HUB-01, HUB-02, HUB-06; UI-SPEC "Path pages",
// "Comparison", "Calculator"; D209, D264, D296, D299, D300, D-UI-P15-25; A1-Q1, A2-Q4).
// One layout, two ramps. Sections in UI-SPEC order:
//   1 first viewport (path chip) -> 2 what's included (card) -> 3 add-ons (stock) ->
//   4 worked examples (card) -> 5 comparison + calculator (Studio only) ->
//   6 Good to know (stock) -> 7 closing CTA (ink).
// - Prices come only from the catalog through the shared label helpers (D264); a failed read
//   prints no price line, never a wrong one.
// - Included lines come from paths.ts; unshipped lines carry ComingSoonTag. Booking is never an
//   included line (D-UI-P15-25): it can only appear as a coming-soon catalog listing.
// - Studio's comparison uses the same gate as Pricing: visibleClaims(CLAIMS, isProductionHub())
//   per request; the section and the calculator hide when no claim row remains (T-15-16-01).
// - "See a live demo" sits beside the CTA in the first viewport, only when the demo URL
//   resolves (D209, CONTEXT specifics).
// - Server component in a private `_components` folder (not a route). Dynamic per request via
//   the pages (P15-P3).
import {
  addonChip,
  CLAIMS,
  exampleTotal,
  EXAMPLES,
  MK_COPY,
  MK_PATHS,
  noAddonsOnPath,
  PATH_CHIPS,
  visibleClaims,
  type MkPathKey,
} from "@cds/core/marketing";
import { catalogRow, pathPriceLine } from "@cds/core/pricing";
import {
  BladeDeck,
  BladeRack,
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
  type BladeChip,
  type FormulaExample,
  type PlanMonthlyCents,
} from "@cds/ui/marketing";
import { Check } from "lucide-react";
import Link from "next/link";
import { isProductionHub } from "../../../../lib/hub-env";
import {
  addonBlades,
  demoSiteUrl,
  marketingCatalog,
} from "../../../../lib/marketing-catalog";

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const H2 =
  "m-0 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]";
const BODY = "m-0 text-[18px] leading-[1.55] [text-wrap:pretty]";

function partChip(key: string, order: readonly string[]): BladeChip {
  if (key === "standard" || key === "studio") return PATH_CHIPS[key];
  return addonChip(key, order).chip;
}

export type PathPageProps = { path: MkPathKey };

export async function PathPage({ path }: PathPageProps) {
  const isStudio = path === "studio";
  const [market, demoUrl] = await Promise.all([
    marketingCatalog(),
    isStudio ? demoSiteUrl() : Promise.resolve(null),
  ]);
  const { catalog, view, publicSlugs } = market;
  const production = isProductionHub();
  const showDrafts = !production;
  const info = MK_PATHS[path];
  const C = MK_COPY.PATHS;
  const order = view.map((e) => e.slug);
  const priceLine = pathPriceLine(catalog, path);

  const blades = addonBlades(view, catalog, { path, listingOrder: order });

  const examples: FormulaExample[] = EXAMPLES.filter(
    (ex) => ex.path === path,
  ).flatMap((ex) => {
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

  // Studio only: comparison + calculator, gated exactly like Pricing (HUB-06, A2-Q4).
  const claims = isStudio ? visibleClaims(CLAIMS, production) : [];
  const showComparison = isStudio && comparisonRows(claims).length > 0;
  const showCalculator = showComparison && calculatorAvailable(claims);
  const refs = footnoteOrder(claims);
  const planCents: PlanMonthlyCents = {
    standard:
      catalogRow(catalog ?? [], "plan", "base", "standard")?.monthlyCents ??
      null,
    studio:
      catalogRow(catalog ?? [], "plan", "base", "studio")?.monthlyCents ?? null,
  };

  // One footnote list under the last comparison part (calculator when shown).
  const footnotes = (
    <ClaimFootnotes
      claims={claims}
      order={refs}
      showDrafts={showDrafts}
      className="mx-auto w-full max-w-[1040px]"
    />
  );

  const h1Id = `mk-${path}-h1`;

  return (
    <>
      {/* 1 · First viewport (path chip) */}
      <ChipField field={PATH_CHIPS[path]} aria-labelledby={h1Id}>
        <div
          className={`${WRAP} grid grid-cols-1 items-center gap-12 py-12 lg:min-h-[min(calc(100svh-72px),760px)] lg:grid-cols-12 lg:gap-8 lg:py-16`}
        >
          <div className="flex flex-col items-start gap-6 lg:col-span-6">
            <h1
              id={h1Id}
              className="m-0 font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]"
            >
              {info.name}
            </h1>
            <p className={`max-w-[40ch] ${BODY}`}>{info.whoFor}</p>
            {priceLine ? (
              <p className="mk-figures m-0 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]">
                {priceLine}
              </p>
            ) : null}
            <div className="flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <MkLinkButton
                href={info.startHref}
                variant="primary"
                size="lg"
                icon="arrow"
              >
                {C.START[path]}
              </MkLinkButton>
              {demoUrl ? (
                <MkLinkButton
                  href={demoUrl}
                  external
                  variant="secondary"
                  size="md"
                >
                  {C.SEE_DEMO}
                </MkLinkButton>
              ) : null}
            </div>
            <Link
              href={info.crossLink.href}
              className="text-[14px] leading-[1.4] font-bold text-mk-fg underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
            >
              {info.crossLink.text}
            </Link>
          </div>
          {blades.length > 0 ? (
            <div className="lg:col-span-6">
              <BladeDeck blades={blades} liftedKey={blades[0]?.key} />
            </div>
          ) : null}
        </div>
      </ChipField>

      {/* 2 · What's included (card) */}
      <ChipField field="card" aria-labelledby={`mk-${path}-included`}>
        <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
          <h2 id={`mk-${path}-included`} className={H2}>
            {C.INCLUDED_H2[path]}
          </h2>
          <ul className="m-0 grid max-w-[1040px] list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
            {info.included.map((line) => (
              <li
                key={line.text}
                data-mk-included={line.shipped ? "shipped" : "soon"}
                className="flex items-start gap-3"
              >
                <Check size={20} aria-hidden="true" className="mt-1 shrink-0" />
                <span className={`${BODY} flex flex-wrap items-center gap-2`}>
                  {line.text}
                  {line.shipped ? null : <ComingSoonTag />}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </ChipField>

      {/* 3 · Add-ons on this path (stock) */}
      <ChipField field="stock" aria-labelledby={`mk-${path}-addons`}>
        <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
          <h2 id={`mk-${path}-addons`} className={H2}>
            {C.ADDONS_H2[path]}
          </h2>
          {blades.length > 0 ? (
            <BladeRack blades={blades} aria-label={C.ADDONS_H2[path]} />
          ) : (
            <p className={`max-w-[60ch] ${BODY}`}>
              {noAddonsOnPath(info.name)}
            </p>
          )}
        </div>
      </ChipField>

      {/* 4 · Worked examples for this path (card); hides when none render */}
      {examples.length > 0 ? (
        <ChipField field="card" aria-labelledby={`mk-${path}-examples`}>
          <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
            <h2 id={`mk-${path}-examples`} className={H2}>
              {MK_COPY.PRICING.EXAMPLES_H2}
            </h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {examples.map((ex) => (
                <FormulaCard key={ex.title} example={ex} />
              ))}
            </div>
          </div>
        </ChipField>
      ) : null}

      {/* 5 · Comparison + calculator (Studio only, gated like Pricing) */}
      {showComparison ? (
        <ChipField
          field="card"
          id="how-they-make-their-money"
          aria-labelledby="comparison-title"
          className="scroll-mt-20 border-t border-mk-rule"
        >
          <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
            <ComparisonTable
              claims={claims}
              showDrafts={showDrafts}
              order={refs}
              className="w-full"
            />
            {showCalculator ? null : footnotes}
          </div>
        </ChipField>
      ) : null}
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
              initialPath="studio"
              order={refs}
            />
            <CalculatorStatic
              claims={claims}
              planMonthlyCents={planCents}
              path="studio"
              order={refs}
            />
            <div className="mt-12">{footnotes}</div>
          </div>
        </ChipField>
      ) : null}

      {/* 6 · Good to know (stock) */}
      <ChipField field="stock" aria-labelledby={`mk-${path}-good`}>
        <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
          <h2 id={`mk-${path}-good`} className={H2}>
            {MK_COPY.PRICING.GOOD_TO_KNOW_H2}
          </h2>
          <dl className="m-0 grid max-w-[1040px] grid-cols-1 gap-6 md:grid-cols-2">
            {C.GOOD_TO_KNOW.map((item) => (
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

      {/* 7 · Closing CTA (ink) */}
      <ChipField field="ink" aria-labelledby={`mk-${path}-close`}>
        <div
          className={`${WRAP} flex flex-col items-start gap-8 py-16 lg:py-24`}
        >
          <h2 id={`mk-${path}-close`} className={H2}>
            {C.CLOSING_H2[path]}
          </h2>
          <MkLinkButton
            href={info.startHref}
            variant="primary"
            size="lg"
            icon="arrow"
          >
            {C.START[path]}
          </MkLinkButton>
        </div>
      </ChipField>
    </>
  );
}
