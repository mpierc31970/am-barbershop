// Settings › Legal (09-20; AGR-06, AGR-07; CONTEXT A3-Q3; D82, D216, D311; 09-UI-SPEC
// "Settings › Legal"; D-UI-P9-17, D-UI-P9-19). Server component over plain props.
//
// Section 1 (agreements): the status strip first, then every signing newest first
// (AgreementHistoryTable), or EMPTY-AGR when there are none. Section 2 "Your site's policy
// pages" (09-23) is SitePolicyPanel through the SitePolicySection client island, from
// server-built `sitePolicy` props (or the `sitePolicies` slot for a load error); the two
// sections sit 32px apart.
import { EmptyState, InlineAlert, buttonClasses } from "@cds/ui/hub";
import {
  AgreementHistoryTable,
  type AgreementHistoryRow,
} from "@cds/ui/hub/legal";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  SitePolicySection,
  type SitePolicySectionProps,
} from "./SitePolicySection";
import {
  EMPTY_AGR_B,
  EMPTY_AGR_H,
  REVIEW_AND_SIGN_LABEL,
  type AgreementStrip,
} from "../../../../lib/legal-panel";

function ReviewAndSign({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={REVIEW_AND_SIGN_LABEL}
      className={buttonClasses("secondary", "sm")}
    >
      {label}
    </Link>
  );
}

export function LegalPanel({
  strip,
  rows,
  emptyAction,
  sitePolicies,
  sitePolicy,
}: {
  strip: AgreementStrip;
  rows: readonly AgreementHistoryRow[];
  /** EMPTY-AGR's Review and sign: the Owner, after Send to CDS, when the strip has none. */
  emptyAction: { label: string; href: string } | null;
  /** Section 2 slot (09-20): used for the section's load error. */
  sitePolicies?: ReactNode;
  /** Section 2 "Your site's policy pages" (09-23), built server-side. */
  sitePolicy?: SitePolicySectionProps | null;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section
        aria-labelledby="legal-agreements"
        className="flex flex-col gap-4"
      >
        <h2
          id="legal-agreements"
          className="text-xl leading-tight font-semibold text-hub-ink"
        >
          Your agreements
        </h2>
        <InlineAlert
          tone={strip.tone}
          action={
            strip.action ? (
              <ReviewAndSign
                href={strip.action.href}
                label={strip.action.label}
              />
            ) : undefined
          }
        >
          {strip.text}
        </InlineAlert>
        {rows.length > 0 ? (
          <AgreementHistoryTable rows={rows} />
        ) : (
          <EmptyState
            heading={EMPTY_AGR_H}
            body={EMPTY_AGR_B}
            action={
              emptyAction ? (
                <ReviewAndSign
                  href={emptyAction.href}
                  label={emptyAction.label}
                />
              ) : undefined
            }
          />
        )}
      </section>
      {sitePolicy ? <SitePolicySection {...sitePolicy} /> : null}
      {sitePolicies ?? null}
    </div>
  );
}
