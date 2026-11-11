// /privacy on tenant hosts (09-22; AGR-08, D217; CONTEXT A5-Q2, A5-Q3; 09-UI-SPEC "Tenant policy
// pages"). A system page rendered live in the site theme from the acknowledged template
// version, the business profile and the active add-ons, under the site chrome (the tenant
// layout). Not acknowledged (or legal inputs blanked since) -> notFound(), the site's 404.
// Server component, zero client JS.
// A static route: it wins over the [[...path]] catch-all; privacy/terms are reserved slugs.
import { PolicyPage } from "@cds/ui/site";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatLegalDate } from "../../../../lib/legal-pages";
import {
  loadSitePolicyPage,
  sitePolicyMetadata,
} from "../../../../lib/site-policy-pages";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host } = await params;
  return sitePolicyMetadata(host, "privacy");
}

export default async function PrivacyPage({ params }: Props) {
  const { host } = await params;
  const policy = await loadSitePolicyPage(host, "privacy");
  if (!policy) notFound();
  return (
    <main
      id="content"
      tabIndex={-1}
      className="outline-none"
      data-policy-page="privacy"
    >
      <PolicyPage
        title="Privacy policy"
        lastUpdatedLabel={formatLegalDate(policy.lastUpdated)}
        html={policy.html}
        draft={policy.draft}
      />
    </main>
  );
}
