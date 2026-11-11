// /studio (15-16; HUB-01, HUB-02, HUB-06): the Studio path page, with the live-demo link
// (D209) and the comparison + calculator preset to Studio. Layout lives in PathPage.
// Dynamic per request, no ISR (P15-P3).
import { MK_COPY, MK_PATHS } from "@cds/core/marketing";
import type { Metadata } from "next";
import { hubCanonical, hubRobots } from "../../../../lib/hub-env";
import { PathPage } from "../_components/PathPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: MK_COPY.SEO.STUDIO_TITLE,
    description: MK_PATHS.studio.whoFor,
    robots: hubRobots(),
    alternates: { canonical: hubCanonical("/studio") },
  };
}

export default function StudioPage() {
  return <PathPage path="studio" />;
}
