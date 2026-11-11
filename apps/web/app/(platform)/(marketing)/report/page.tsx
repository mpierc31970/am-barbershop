// /report on the platform host (STAFF-24, D249, P13-P24; restyled in 15-20 for HUB-07, A3-Q3,
// D-UI-P15-23; UI-SPEC "Report"). Public, no session: the target of every tenant footer's
// un-removable Report link (`?site=<host>`, apps/web/lib/site-chrome reportHref). A valid
// `?site=` (host shape checked) pre-fills Site and Page address `https://<host>/`; anything
// else is ignored. noindex in every environment keeps reports out of search (T-15-20-02).
// Inside the marketing layout: card ground, header (H1 + intro + the abuse@ line, mailto) then
// two columns >= 1024px (form 640px left, ReportAside right, sticky), stacked below with the
// aside after the form. The form contract (ids, names, REPORT_COPY, action, case flow) is
// unchanged. The header is handed to the form island, which swaps it for "Report received".
// Tenant hosts never reach this route: the middleware rewrites them to /tenant/<host>.
import { ABUSE_EMAIL, MK_ABUSE_LINE } from "@cds/core/marketing";
import { ChipField, ReportAside } from "@cds/ui/marketing";
import type { Metadata } from "next";
import {
  cleanHost,
  prefillUrl,
  REPORT_COPY,
} from "../../../../lib/report-form";
import { ReportForm } from "./ReportForm";

export const metadata: Metadata = {
  title: REPORT_COPY.TITLE,
  // 13-51: Lighthouse meta-description gate; the page's own intro line.
  description: REPORT_COPY.INTRO,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** The D249 abuse mailbox (the page test pins it to ABUSE_EMAIL). Next allows no extra exports. */
const ABUSE_HREF = "mailto:abuse@connectionsdesignstudios.com";

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const H1 =
  "m-0 max-w-[16ch] font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]";
const BODY = "m-0 max-w-[48ch] text-[18px] leading-[1.55] [text-wrap:pretty]";
const LINK =
  "font-bold break-all text-mk-fg underline decoration-1 underline-offset-[0.2em] hover:decoration-2";

type SearchParams = Record<string, string | string[] | undefined>;

function AbuseLine() {
  // "or email <address>": the address is the link (UI-SPEC Voice, verbatim line).
  const [before = "", after = ""] = MK_ABUSE_LINE.split(ABUSE_EMAIL);
  return (
    <p className={BODY} data-testid="report-abuse-line">
      {before}
      <a href={ABUSE_HREF} className={LINK}>
        {ABUSE_EMAIL}
      </a>
      {after}
    </p>
  );
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp: SearchParams = (await searchParams) ?? {};
  const raw = Array.isArray(sp.site) ? sp.site[0] : sp.site;
  const site = cleanHost(raw) ?? "";
  return (
    <ChipField field="card" aria-label={REPORT_COPY.TITLE}>
      <div className={`${WRAP} py-16 lg:py-24`}>
        <ReportForm
          initialSite={site}
          initialUrl={prefillUrl(site)}
          header={
            <div className="flex flex-col items-start gap-6">
              <h1 className={H1}>{REPORT_COPY.TITLE}</h1>
              <div className="flex flex-col gap-2">
                <p className={BODY}>{REPORT_COPY.INTRO}</p>
                <AbuseLine />
              </div>
            </div>
          }
          aside={<ReportAside className="lg:max-w-[40ch]" />}
        />
      </div>
    </ChipField>
  );
}
