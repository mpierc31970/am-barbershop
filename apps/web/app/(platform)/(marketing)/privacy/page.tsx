// /privacy (15-18; HUB-03, P15-P13; UI-SPEC "Read pages"). The hub's own privacy notice
// (HUB_PRIVACY in @cds/core/marketing), not a signed policy: no POLICY_KEY. The body goes through
// renderLegalMarkdown (escape-first subset, https/mailto links only; T-15-18-01). While the
// notice is a draft the marigold DRAFT band shows above it, in every environment (T-15-18-02).
// Indexed in production. Dynamic per request, no ISR (P15-P3).
import { renderLegalMarkdown } from "@cds/core/legal";
import { formatCheckedDate, HUB_PRIVACY, MK_COPY } from "@cds/core/marketing";
import { ChipField, ProseBlock } from "@cds/ui/marketing";
import type { Metadata } from "next";
import { hubCanonical, hubRobots } from "../../../../lib/hub-env";
import { MK_LEGAL_HTML, MK_READ_H1, MK_READ_WRAP } from "../_components/read";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.PRIVACY_TITLE,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/privacy") },
  };
}

export default function PrivacyPage() {
  const P = MK_COPY.PRIVACY;
  const html = renderLegalMarkdown(HUB_PRIVACY.markdown);

  return (
    <ChipField field="card" aria-labelledby="mk-privacy-h1">
      <div className={MK_READ_WRAP}>
        <ProseBlock as="article" className="flex flex-col gap-8">
          <header className="flex flex-col gap-6">
            <h1 id="mk-privacy-h1" className={MK_READ_H1}>
              {P.H1}
            </h1>
            {HUB_PRIVACY.draft ? (
              <ChipField
                field="marigold"
                as="div"
                data-testid="mk-privacy-draft"
                className="border border-mk-ink px-4 py-3 text-[16px] leading-[1.4] font-bold"
              >
                {P.DRAFT}
              </ChipField>
            ) : null}
            <p className="text-[16px] leading-[1.4] text-mk-muted">
              {P.UPDATED}{" "}
              <time dateTime={HUB_PRIVACY.updated}>
                {formatCheckedDate(HUB_PRIVACY.updated)}
              </time>
            </p>
          </header>
          <div
            className={MK_LEGAL_HTML}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </ProseBlock>
      </div>
    </ChipField>
  );
}
