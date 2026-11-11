// /legal/<key> on the platform host (09-09; AGR-01, AGR-07; CONTEXT A3-Q4, D215, D216): the
// current version of one of the five CDS policies, public, no sign-in. Reads only the compiled
// POLICY_SET (09-09 choice 1), so it renders even when PocketBase is down. Unknown key ->
// not-found. Current versions are indexable.
import { POLICY_KEYS } from "@cds/core/legal";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveLegalPage } from "../../../../lib/legal-pages";
import { LegalFrame } from "../_components/LegalFrame";
import { PolicyArticle } from "../_components/PolicyArticle";

type Props = { params: Promise<{ key: string }> };

export function generateStaticParams(): { key: string }[] {
  return POLICY_KEYS.map((key) => ({ key }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = resolveLegalPage((await params).key);
  if (!page) return {};
  return { title: `${page.policy.title} · A&M Barber Studio` };
}

export default async function LegalPolicyPage({ params }: Props) {
  const page = resolveLegalPage((await params).key);
  if (!page) notFound();
  return (
    <LegalFrame>
      <PolicyArticle page={page} />
    </LegalFrame>
  );
}
