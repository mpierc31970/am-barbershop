// The CDS hub home (15-14; HUB-01, HUB-02; UI-SPEC "Home", D34, D264, A1-Q1, A1-Q6, A2-Q2,
// A3-Q4). Sections in UI-SPEC order, each on its ground (one-axis raise): first viewport
// (card) -> two paths (cobalt + berry) -> worked examples (stock) -> how it works (card) ->
// proof (berry demo, then card) -> money line (marigold) -> closing CTA (ink).
// - Every price comes from the catalog through the shared label helpers (D264); a failed
//   catalog read prints no price lines, never wrong ones (marketingCatalog never throws).
// - Proof is visibleProof(…, isProductionHub()): production shows confirmed entries only
//   (P15-P15, T-15-14-02); dev shows every entry with a DRAFT badge.
// - Dynamic per request, no ISR (P15-P3): nothing here runs at build time.
// - JSON-LD is a static object with `<` escaped (T-15-14-01).
import {
  addonChip,
  CLAIMS,
  exampleTotal,
  EXAMPLES,
  HELLO_EMAIL,
  MK_COPY,
  MK_PATHS,
  PATH_CHIPS,
  SHOP_SOON,
  TESTIMONIALS,
  visibleClaims,
  visibleProof,
  WORK_SITES,
  type MkPathKey,
} from "@cds/core/marketing";
import { pathPriceLine } from "@cds/core/pricing";
import {
  BladeDeck,
  ChipField,
  ComingSoonTag,
  comparisonRows,
  FormulaCard,
  MkLinkButton,
  PathField,
  ProofList,
  RivetMark,
  StepsList,
  TestimonialList,
  DemoPanel,
  type BladeChip,
  type FormulaExample,
} from "@cds/ui/marketing";
import type { Metadata } from "next";
import { hubCanonical, hubRobots, isProductionHub } from "../../../lib/hub-env";
import {
  addonBlades,
  demoSiteUrl,
  marketingCatalog,
  pathBlades,
} from "../../../lib/marketing-catalog";

export const dynamic = "force-dynamic";

const HUB_URL = "https://connectionsdesignstudios.com";
const HOME_PATHS: readonly MkPathKey[] = ["standard", "studio"];
const MAX_EXAMPLES = 3;
const MAX_BLADES = 9;

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const H2 =
  "font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]";
const BODY = "text-[18px] leading-[1.55] [text-wrap:pretty]";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.HOME_TITLE,
    description: MK_COPY.SEO.HOME_DESCRIPTION,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/") },
  };
}

/** The Organization JSON-LD: a static object, `<` escaped so it can't close the script. */
function homeJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: MK_COPY.SEO.ORG_NAME,
    url: HUB_URL,
    email: HELLO_EMAIL,
  }).replace(/</g, "\\u003c");
}

function partChip(key: string, order: readonly string[]): BladeChip {
  if (key === "standard" || key === "studio") return PATH_CHIPS[key];
  return addonChip(key, order).chip;
}

export default async function HomePage() {
  const [market, demoUrl] = await Promise.all([
    marketingCatalog(),
    demoSiteUrl(),
  ]);
  const production = isProductionHub();
  const showDrafts = !production;
  // 15 WR-A05: Pricing renders #how-they-make-their-money only when a claim is visible (in
  // production: verified). Same rule here, so the money link never lands on a missing anchor.
  const showMoneyLink =
    comparisonRows(visibleClaims(CLAIMS, production)).length > 0;
  const { catalog, view, publicSlugs } = market;
  const order = view.map((e) => e.slug);

  const blades = [
    ...pathBlades(catalog),
    ...addonBlades(view, catalog, { listingOrder: order }),
  ].slice(0, MAX_BLADES);

  const examples: FormulaExample[] = [];
  for (const ex of EXAMPLES) {
    if (examples.length >= MAX_EXAMPLES) break;
    const total = exampleTotal(ex, catalog, publicSlugs);
    if (total === null) continue;
    examples.push({
      title: ex.title,
      parts: total.parts.map((p) => ({
        name: p.name,
        chip: partChip(p.chipKey, order),
      })),
      total: total.label,
    });
  }

  const sites = visibleProof(WORK_SITES, production).slice(0, 4);
  const quotes = visibleProof(TESTIMONIALS, production).slice(0, 2);
  const H = MK_COPY.HOME;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: homeJsonLd() }}
      />

      {/* 1 · First viewport (card) */}
      <ChipField field="card" aria-labelledby="mk-home-h1">
        <div
          className={`${WRAP} grid grid-cols-1 items-center gap-12 py-12 lg:min-h-[min(calc(100svh-72px),880px)] lg:grid-cols-12 lg:gap-8 lg:py-16`}
        >
          <div className="flex flex-col items-start gap-6 lg:col-span-6 xl:col-span-7">
            <h1
              id="mk-home-h1"
              className="max-w-[16ch] font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]"
            >
              {H.H1}
            </h1>
            <p className={`max-w-[40ch] ${BODY}`}>{H.LEAD}</p>
            <p className="flex items-center gap-3 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]">
              <RivetMark fill="leaf" />
              <span>{H.PITCH}</span>
            </p>
            <div className="flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
              <MkLinkButton
                href="/start"
                variant="primary"
                size="lg"
                icon="arrow"
              >
                {H.START}
              </MkLinkButton>
              <MkLinkButton href="/pricing" variant="text">
                {H.SEE_PRICING}
              </MkLinkButton>
              {demoUrl ? (
                <MkLinkButton href={demoUrl} external variant="text">
                  {H.SEE_DEMO}
                </MkLinkButton>
              ) : null}
            </div>
          </div>
          <div className="lg:col-span-6 xl:col-span-5">
            <BladeDeck blades={blades} liftedKey="standard" />
          </div>
        </div>
      </ChipField>

      {/* 2 · Two paths (cobalt + berry), then the Shop band */}
      <section aria-labelledby="mk-home-paths">
        <div data-mk-field="card" className="py-16">
          <div className={WRAP}>
            <h2 id="mk-home-paths" className={H2}>
              {H.PATHS_H2}
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {HOME_PATHS.map((key) => (
            <PathField
              key={key}
              path={key}
              whoFor={MK_PATHS[key].whoFor}
              priceLine={pathPriceLine(catalog, key)}
              included={MK_PATHS[key].included.slice(0, 4)}
              startHref={MK_PATHS[key].startHref}
              aboutHref={MK_PATHS[key].aboutHref}
            />
          ))}
        </div>
        <div data-mk-field="card" className="py-8">
          <div className={WRAP}>
            <div className="flex flex-col items-start gap-4 rounded-mk-blade border border-mk-ink p-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <p className={`flex flex-wrap items-center gap-3 ${BODY}`}>
                <span>{SHOP_SOON.band}</span>
                <ComingSoonTag />
              </p>
              <MkLinkButton href={SHOP_SOON.askHref} variant="text">
                {SHOP_SOON.askLabel}
              </MkLinkButton>
            </div>
          </div>
        </div>
      </section>

      {/* 3 · What it costs, worked out (stock); hides when no example renders */}
      {examples.length > 0 ? (
        <ChipField field="stock" aria-labelledby="mk-home-examples">
          <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
            <h2 id="mk-home-examples" className={H2}>
              {H.EXAMPLES_H2}
            </h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {examples.map((ex) => (
                <FormulaCard key={ex.title} example={ex} />
              ))}
            </div>
            <MkLinkButton href="/pricing" variant="text">
              {H.SEE_ALL_PRICES}
            </MkLinkButton>
          </div>
        </ChipField>
      ) : null}

      {/* 4 · How it works (card) */}
      <ChipField field="card" aria-labelledby="mk-home-how">
        <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
          <h2 id="mk-home-how" className={H2}>
            {H.HOW_H2}
          </h2>
          <StepsList steps={H.STEPS} />
        </div>
      </ChipField>

      {/* 5 · Proof: demo (berry), then sites and testimonials (card) */}
      <DemoPanel url={demoUrl} />
      {sites.length > 0 || quotes.length > 0 ? (
        <ChipField field="card" aria-label={H.PROOF_H2}>
          <div className={`${WRAP} flex flex-col gap-16 py-16 lg:py-24`}>
            {sites.length > 0 ? (
              <div className="flex flex-col items-start gap-6">
                <ProofList
                  sites={sites}
                  showDrafts={showDrafts}
                  title={H.PROOF_H2}
                  limit={4}
                  className="w-full"
                />
                <MkLinkButton href="/work" variant="text">
                  {H.SEE_WORK}
                </MkLinkButton>
              </div>
            ) : null}
            <TestimonialList
              items={quotes}
              showDrafts={showDrafts}
              title={MK_COPY.WORK.SAY_H2}
              limit={2}
            />
          </div>
        </ChipField>
      ) : null}

      {/* 6 · Money line (marigold band) */}
      <ChipField field="marigold" aria-label={H.MONEY_LINE}>
        <div className={`${WRAP} flex flex-col items-start gap-4 py-12`}>
          <p className="flex items-center gap-3 font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]">
            <RivetMark fill="leaf" />
            <span>{H.MONEY_LINE}</span>
          </p>
          <p className={`max-w-[60ch] ${BODY}`}>{H.MONEY_BODY}</p>
          {showMoneyLink ? (
            <MkLinkButton
              href="/pricing#how-they-make-their-money"
              variant="text"
            >
              {H.MONEY_LINK}
            </MkLinkButton>
          ) : null}
        </div>
      </ChipField>

      {/* 7 · Closing CTA (ink) */}
      <ChipField field="ink" aria-labelledby="mk-home-close">
        <div
          className={`${WRAP} flex flex-col items-start gap-8 py-16 lg:py-24`}
        >
          <h2 id="mk-home-close" className={H2}>
            {H.CLOSING_H2}
          </h2>
          <MkLinkButton href="/start" variant="primary" size="lg" icon="arrow">
            {H.START}
          </MkLinkButton>
        </div>
      </ChipField>
    </>
  );
}
