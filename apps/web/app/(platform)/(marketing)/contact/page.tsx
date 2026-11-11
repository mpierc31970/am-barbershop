// /contact (15-19; HUB-07, HUB-03; A3-Q2, D-UI-P15-19, D-UI-P15-20; UI-SPEC "Contact"). Operate:
// header (H1 + lead) then two columns >= 1024px (form 640px left, aside right), stacked below with
// the aside after the form. The aside gives hello@ (mailto), the Report page (content on hosted
// sites stays on /report, HUB-07) and the Sign in line for customers (CDS Support).
// - `?topic=` and `?about=` are read here and allow-listed by contactPrefill against the public
//   catalog view + the two fixed keys (T-15-19-03); anything else is ignored.
// - Dynamic per request, no ISR (P15-P3); noindex outside production (P15-P4).
import { MK_COPY } from "@cds/core/marketing";
import { ChipField } from "@cds/ui/marketing";
import { Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { contactPrefill } from "../../../../lib/contact-form";
import { hubCanonical, hubRobots } from "../../../../lib/hub-env";
import { marketingCatalog } from "../../../../lib/marketing-catalog";
import { ContactForm } from "./ContactForm";

export const dynamic = "force-dynamic";

const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8";
const H1 =
  "m-0 max-w-[16ch] font-mk-display text-[clamp(48px,6vw+16px,96px)] leading-[0.95] font-bold tracking-[-0.02em] [text-wrap:balance]";
const BODY = "m-0 text-[18px] leading-[1.55] [text-wrap:pretty]";
const LINK =
  "font-bold text-mk-fg underline decoration-1 underline-offset-[0.2em] hover:decoration-2";

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.CONTACT_TITLE,
    description: MK_COPY.CONTACT.LEAD,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/contact") },
  };
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const C = MK_COPY.CONTACT;
  const sp: SearchParams = (await searchParams) ?? {};
  const { view, publicSlugs } = await marketingCatalog();
  const prefill = contactPrefill(sp, publicSlugs, view);

  return (
    <ChipField field="card" aria-labelledby="mk-contact-h1">
      <div className={`${WRAP} flex flex-col gap-12 py-16 lg:py-24`}>
        <div className="flex flex-col items-start gap-6">
          <h1 id="mk-contact-h1" className={H1}>
            {C.H1}
          </h1>
          <p className={`max-w-[48ch] ${BODY}`}>{C.LEAD}</p>
        </div>

        <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:gap-16">
          <div className="w-full lg:max-w-[640px] lg:flex-[0_1_640px]">
            <ContactForm
              initialTopic={prefill.topic}
              initialAbout={prefill.about}
              initialMessage={prefill.message}
            />
          </div>

          <aside
            aria-label={C.H1}
            className="flex flex-col gap-6 border-t border-mk-rule pt-8 lg:max-w-[40ch] lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8"
          >
            <p className={`flex items-center gap-3 ${BODY}`}>
              <Mail size={20} aria-hidden="true" className="shrink-0" />
              <a href={`mailto:${C.EMAIL}`} className={`break-all ${LINK}`}>
                {C.EMAIL}
              </a>
            </p>
            <p className={BODY}>
              {C.ASIDE_REPORT_BEFORE}{" "}
              <Link href="/report" className={LINK}>
                {C.ASIDE_REPORT_LINK}
              </Link>
              .
            </p>
            <p className={BODY}>
              {C.ASIDE_SIGN_IN_BEFORE}{" "}
              <Link href="/sign-in" className={LINK}>
                {C.ASIDE_SIGN_IN_LINK}
              </Link>{" "}
              {C.ASIDE_SIGN_IN_AFTER}
            </p>
          </aside>
        </div>
      </div>
    </ChipField>
  );
}
