// /about (15-18; HUB-01, HUB-03; UI-SPEC "About", A1-Q4). First viewport (card) -> How we work
// (stock, three short paragraphs) -> Who we work with (card, path links) -> facts (card) ->
// closing CTA (ink).
// - Facts are ABOUT_FACTS only (the parity inventory's facts): no history, founders, team or
//   figures (T-15-18-03). Same confirmed rule as proof: production shows confirmed facts only,
//   dev shows all with a DRAFT badge; the section hides when none are visible.
// - Dynamic per request, no ISR (P15-P3).
import {
  ABOUT_FACTS,
  MK_COPY,
  MK_PATHS,
  visibleProof,
  type AboutFact,
  type MkPathKey,
} from "@cds/core/marketing";
import { ChipField, DraftBadge, MkLinkButton } from "@cds/ui/marketing";
import type { Metadata } from "next";
import Link from "next/link";
import {
  hubCanonical,
  hubRobots,
  isProductionHub,
} from "../../../../lib/hub-env";

export const dynamic = "force-dynamic";

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const H1 =
  "max-w-[16ch] font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]";
const H2 =
  "font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]";
const H3 = "font-mk-display text-[24px] leading-[1.2] font-bold";
const BODY = "text-[18px] leading-[1.55] [text-wrap:pretty]";
const PATHS: readonly MkPathKey[] = ["standard", "studio"];
const DOT: Record<MkPathKey, string> = {
  standard: "bg-mk-cobalt",
  studio: "bg-mk-berry",
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.ABOUT_TITLE,
    description: MK_COPY.ABOUT.LEAD,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/about") },
  };
}

/** Email and phone facts become mailto/tel links; everything else is plain text. */
function factValue(fact: AboutFact) {
  if (fact.value.includes("@")) {
    return (
      <a href={`mailto:${fact.value}`} className="underline underline-offset-4">
        {fact.value}
      </a>
    );
  }
  if (/^[\d\s().+-]{7,}$/.test(fact.value)) {
    return (
      <a
        href={`tel:${fact.value.replace(/[^\d+]/g, "")}`}
        className="underline underline-offset-4"
      >
        {fact.value}
      </a>
    );
  }
  return fact.value;
}

export default function AboutPage() {
  const production = isProductionHub();
  const facts = visibleProof(ABOUT_FACTS, production);
  const A = MK_COPY.ABOUT;

  return (
    <>
      {/* 1 · First viewport (card) */}
      <ChipField field="card" aria-labelledby="mk-about-h1">
        <div
          className={`${WRAP} flex flex-col items-start gap-6 py-16 lg:py-24`}
        >
          <h1 id="mk-about-h1" className={H1}>
            {A.H1}
          </h1>
          <p className={`max-w-[48ch] ${BODY}`}>{A.LEAD}</p>
        </div>
      </ChipField>

      {/* 2 · How we work (stock): three short paragraphs, no cards */}
      <ChipField
        field="stock"
        aria-label={A.HOW.map((h) => h.title).join(", ")}
      >
        <div
          className={`${WRAP} grid grid-cols-1 gap-10 py-16 lg:grid-cols-3 lg:gap-8 lg:py-24`}
        >
          {A.HOW.map((h) => (
            <div key={h.title} className="flex max-w-[48ch] flex-col gap-3">
              <h2 className={H3}>{h.title}</h2>
              <p className={BODY}>{h.body}</p>
            </div>
          ))}
        </div>
      </ChipField>

      {/* 3 · Who we work with (card) */}
      <ChipField field="card" aria-labelledby="mk-about-who">
        <div
          className={`${WRAP} flex flex-col items-start gap-6 py-16 lg:py-24`}
        >
          <h2 id="mk-about-who" className={H2}>
            {A.WHO_H2}
          </h2>
          <p className={`max-w-[60ch] ${BODY}`}>{A.WHO_BODY}</p>
          <ul className="flex flex-wrap gap-x-8 gap-y-2">
            {PATHS.map((key) => (
              <li key={key}>
                <Link
                  href={MK_PATHS[key].aboutHref}
                  className="inline-flex min-h-11 items-center gap-2 text-[18px] font-bold underline underline-offset-4"
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block size-3 rounded-full ${DOT[key]}`}
                  />
                  {MK_PATHS[key].name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </ChipField>

      {/* 4 · Facts from the parity inventory (card); hides when none are visible */}
      {facts.length > 0 ? (
        <ChipField
          field="card"
          aria-label={MK_COPY.SEO.ORG_NAME}
          className="border-t border-mk-rule"
        >
          <div className={`${WRAP} py-12`}>
            <dl
              className="grid max-w-[60ch] grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-[max-content_1fr]"
              data-testid="mk-about-facts"
            >
              {facts.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-[16px] leading-[1.4] font-bold">
                    {f.label}
                  </dt>
                  <dd className={`flex flex-wrap items-center gap-3 ${BODY}`}>
                    <span>{factValue(f)}</span>
                    <DraftBadge show={!production && !f.confirmed} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </ChipField>
      ) : null}

      {/* 5 · Closing CTA (ink) */}
      <ChipField field="ink" aria-labelledby="mk-about-close">
        <div
          className={`${WRAP} flex flex-col items-start gap-8 py-16 lg:py-24`}
        >
          <h2 id="mk-about-close" className={H2}>
            {A.CLOSING_H2}
          </h2>
          <div className="flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:items-center">
            <MkLinkButton href="/contact" variant="secondary" size="lg">
              {A.CONTACT}
            </MkLinkButton>
            <MkLinkButton
              href="/start"
              variant="primary"
              size="lg"
              icon="arrow"
            >
              {A.START}
            </MkLinkButton>
          </div>
        </div>
      </ChipField>
    </>
  );
}
