// /work (15-18; HUB-01, HUB-03; UI-SPEC "Work", A1-Q6, P15-P15). First viewport (card) -> live
// demo (berry) -> Sites we've built (card) -> What clients say (stock) -> closing CTA (ink).
// - Proof is visibleProof(…, isProductionHub()): production shows confirmed entries only;
//   dev and preview show every entry with a DRAFT badge (T-15-18-03).
// - Sections hide individually; when both hide, one card line points at the demo.
// - Dynamic per request, no ISR (P15-P3).
import {
  MK_COPY,
  TESTIMONIALS,
  visibleProof,
  WORK_SITES,
} from "@cds/core/marketing";
import {
  ChipField,
  DemoPanel,
  MkLinkButton,
  ProofList,
  TestimonialList,
} from "@cds/ui/marketing";
import type { Metadata } from "next";
import {
  hubCanonical,
  hubRobots,
  isProductionHub,
} from "../../../../lib/hub-env";
import { demoSiteUrl } from "../../../../lib/marketing-catalog";

export const dynamic = "force-dynamic";

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const H1 =
  "max-w-[16ch] font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]";
const H2 =
  "font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]";
const BODY = "text-[18px] leading-[1.55] [text-wrap:pretty]";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.WORK_TITLE,
    description: MK_COPY.WORK.LEAD,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/work") },
  };
}

export default async function WorkPage() {
  const demoUrl = await demoSiteUrl();
  const production = isProductionHub();
  const showDrafts = !production;
  const sites = visibleProof(WORK_SITES, production);
  const quotes = visibleProof(TESTIMONIALS, production);
  const W = MK_COPY.WORK;

  return (
    <>
      {/* 1 · First viewport (card) */}
      <ChipField field="card" aria-labelledby="mk-work-h1">
        <div
          className={`${WRAP} flex flex-col items-start gap-6 py-16 lg:py-24`}
        >
          <h1 id="mk-work-h1" className={H1}>
            {W.H1}
          </h1>
          <p className={`max-w-[40ch] ${BODY}`}>{W.LEAD}</p>
        </div>
      </ChipField>

      {/* 2 · Demo (berry); hides when the demo URL can't be resolved */}
      <DemoPanel url={demoUrl} />

      {/* 3 · Sites we've built (card) */}
      {sites.length > 0 ? (
        <ChipField field="card" aria-label={W.SITES_H2}>
          <div className={`${WRAP} py-16 lg:py-24`}>
            <ProofList
              sites={sites}
              showDrafts={showDrafts}
              title={W.SITES_H2}
              className="w-full"
            />
          </div>
        </ChipField>
      ) : null}

      {/* 4 · What clients say (stock) */}
      {quotes.length > 0 ? (
        <ChipField field="stock" aria-label={W.SAY_H2}>
          <div className={`${WRAP} py-16 lg:py-24`}>
            <TestimonialList
              items={quotes}
              showDrafts={showDrafts}
              title={W.SAY_H2}
            />
          </div>
        </ChipField>
      ) : null}

      {/* Empty: both proof sections hidden */}
      {sites.length === 0 && quotes.length === 0 ? (
        <ChipField field="card" as="div">
          <div className={`${WRAP} py-12`}>
            <p className={`max-w-[60ch] ${BODY}`} data-testid="mk-work-empty">
              {W.EMPTY}
            </p>
          </div>
        </ChipField>
      ) : null}

      {/* 5 · Closing CTA (ink) */}
      <ChipField field="ink" aria-labelledby="mk-work-close">
        <div
          className={`${WRAP} flex flex-col items-start gap-8 py-16 lg:py-24`}
        >
          <h2 id="mk-work-close" className={H2}>
            {W.CLOSING_H2}
          </h2>
          <MkLinkButton href="/start" variant="primary" size="lg" icon="arrow">
            {W.START}
          </MkLinkButton>
        </div>
      </ChipField>
    </>
  );
}
