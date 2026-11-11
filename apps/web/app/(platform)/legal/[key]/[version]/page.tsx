// /legal/<key>/v<N> on the platform host (09-09; AGR-01; CONTEXT A3-Q4; 09-UI-SPEC "Public
// policy pages"): any version of a policy, so anyone can check what was signed. The segment
// must be v<N> (09-09 choice 2, T-09-09-03); anything else, or an unknown version, is
// not-found. Past versions are noindex; the current version stays indexable.
import { POLICY_SET } from "@cds/core/legal";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  parseVersionSegment,
  resolveLegalPage,
} from "../../../../../lib/legal-pages";
import { LegalFrame } from "../../_components/LegalFrame";
import { PolicyArticle } from "../../_components/PolicyArticle";

type Props = { params: Promise<{ key: string; version: string }> };

export function generateStaticParams(): { key: string; version: string }[] {
  return POLICY_SET.policies.map((p) => ({
    key: p.key,
    version: `v${p.version}`,
  }));
}

async function pageFor(params: Props["params"]) {
  const { key, version } = await params;
  const n = parseVersionSegment(version);
  return n === null ? null : resolveLegalPage(key, n);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await pageFor(params);
  if (!page) return {};
  const title = `${page.policy.title} · A&M Barber Studio`;
  return page.isCurrent
    ? { title }
    : { title, robots: { index: false, follow: true } };
}

export default async function LegalPolicyVersionPage({ params }: Props) {
  const page = await pageFor(params);
  if (!page) notFound();
  return (
    <LegalFrame>
      <PolicyArticle page={page} />
    </LegalFrame>
  );
}
