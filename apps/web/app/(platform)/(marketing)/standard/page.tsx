// /standard (15-16; HUB-01, HUB-02): the Standard path page. Layout lives in PathPage.
// Dynamic per request, no ISR (P15-P3).
import { MK_COPY, MK_PATHS } from "@cds/core/marketing";
import type { Metadata } from "next";
import { hubCanonical, hubRobots } from "../../../../lib/hub-env";
import { PathPage } from "../_components/PathPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.STANDARD_TITLE,
    description: MK_PATHS.standard.whoFor,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/standard") },
  };
}

export default function StandardPage() {
  return <PathPage path="standard" />;
}
