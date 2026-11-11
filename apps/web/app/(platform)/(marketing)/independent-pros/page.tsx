// /independent-pros (15-18; D168, D-UI-P15-26; UI-SPEC "Independent pros"). First viewport (card)
// -> How it works (stock, ordered list) -> neutral rule + code line (card) -> CTAs.
// - Offer terms are INDEPENDENT_PRO_OFFER only (D168): no other figure.
// - The code line shows only when INDEPENDENT_PRO_CODE is set (null until the GO-LIVE Stripe
//   promotion code row); otherwise "Mention it when you contact us…".
// - Dynamic per request, no ISR (P15-P3).
import {
  independentProCodeLine,
  INDEPENDENT_PRO_CODE,
  MK_COPY,
} from "@cds/core/marketing";
import { ChipField, MkLinkButton } from "@cds/ui/marketing";
import type { Metadata } from "next";
import { hubCanonical, hubRobots } from "../../../../lib/hub-env";

export const dynamic = "force-dynamic";

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const H1 =
  "max-w-[16ch] font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]";
const H2 =
  "font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]";
const BODY = "text-[18px] leading-[1.55] [text-wrap:pretty]";

const ASK_HREF = "/contact?topic=question&about=independent-pro";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.INDIE_TITLE,
    description: MK_COPY.INDIE.LEAD,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/independent-pros") },
  };
}

/** "Use code <b>CODE</b> at checkout." with the code drawn in bold. */
function CodeLine({ code }: { code: string }) {
  const line = independentProCodeLine(code);
  const at = line.indexOf(code);
  return (
    <p className={BODY} data-testid="mk-indie-code">
      {line.slice(0, at)}
      <strong className="font-bold">{code}</strong>
      {line.slice(at + code.length)}
    </p>
  );
}

export default function IndependentProsPage() {
  const I = MK_COPY.INDIE;
  const code = INDEPENDENT_PRO_CODE;

  return (
    <>
      {/* 1 · First viewport (card) */}
      <ChipField field="card" aria-labelledby="mk-indie-h1">
        <div
          className={`${WRAP} flex flex-col items-start gap-6 py-16 lg:py-24`}
        >
          <h1 id="mk-indie-h1" className={H1}>
            {I.H1}
          </h1>
          <p className={`max-w-[48ch] ${BODY}`}>{I.LEAD}</p>
        </div>
      </ChipField>

      {/* 2 · How it works (stock) */}
      <ChipField field="stock" aria-labelledby="mk-indie-how">
        <div className={`${WRAP} flex flex-col gap-8 py-16 lg:py-24`}>
          <h2 id="mk-indie-how" className={H2}>
            {MK_COPY.HOME.HOW_H2}
          </h2>
          <ol className="flex max-w-[60ch] flex-col gap-6">
            {I.STEPS.map((step, i) => (
              <li key={step} className="flex items-baseline gap-4">
                <span
                  aria-hidden="true"
                  className="mk-figures w-8 shrink-0 text-[24px] leading-[1.2] font-bold"
                >
                  {i + 1}
                </span>
                <span className={BODY}>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </ChipField>

      {/* 3 · Neutral rule, code line and CTAs (card) */}
      <ChipField field="card" aria-label={I.ASK}>
        <div
          className={`${WRAP} flex flex-col items-start gap-6 py-16 lg:py-24`}
        >
          <p className={`max-w-[60ch] ${BODY}`}>{I.NEUTRAL}</p>
          {code ? (
            <CodeLine code={code} />
          ) : (
            <p className={`max-w-[60ch] ${BODY}`}>{I.NO_CODE}</p>
          )}
          <div className="flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:items-center sm:gap-x-6">
            <MkLinkButton
              href="/start"
              variant="primary"
              size="lg"
              icon="arrow"
            >
              {I.START}
            </MkLinkButton>
            <MkLinkButton href={ASK_HREF} variant="text">
              {I.ASK}
            </MkLinkButton>
          </div>
        </div>
      </ChipField>
    </>
  );
}
