// /hub/setup/[stage]: one setup step (06-18; 06-UI-SPEC "Stages"; ONB-01, ONB-02). An
// unknown slug is a 404. The StageFrame (rail, header with autosave status, footer) wraps
// the form registered for the slug in STAGE_FORMS (stage-forms.ts: business: BusinessStage,
// contact: ContactStage, email: EmailStage, words: WordsStage, people: PeopleStage, look:
// LookStage and "the-rest": TheRestStage); a slug with no form would show the load error
// inside the frame.
// Data loads through the chokepoint (business read; the words step also reads the services,
// the people step the team, the email step the email routes and the mail domain; every step
// gets the photos and the stored mood board proposal): an Editor sees every field read-only,
// a Viewer is refused by the chokepoint and gets the load error.
import { isStageSlug, STAGES } from "@cds/core/intake";
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStageData, type StageData } from "../../../../../lib/intake";
import { requireHubSession } from "../../../../../lib/session";
import { StageFrame } from "./StageFrame";
import { STAGE_FORMS } from "./stage-forms";

export const dynamic = "force-dynamic";

const LOAD_ERROR_COPY =
  "We couldn't load this. Check your connection and try again.";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ stage: string }>;
}): Promise<Metadata> {
  const { stage } = await params;
  const name = STAGES.find((s) => s.slug === stage)?.name;
  return { title: name ? `${name} · Set up your site` : "Set up your site" };
}

function LoadError({ href }: { href: string }) {
  return (
    <InlineAlert
      tone="error"
      action={
        <Link href={href} className={buttonClasses("secondary", "sm")}>
          Try again
        </Link>
      }
    >
      {LOAD_ERROR_COPY}
    </InlineAlert>
  );
}

export default async function StagePage({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage: slug } = await params;
  if (!isStageSlug(slug)) notFound();
  const href = `/hub/setup/${slug}`;
  const { ctx } = await requireHubSession();

  let data: StageData;
  try {
    data = await loadStageData(ctx, slug);
  } catch (err) {
    console.error("[setup] loadStageData failed", err);
    return <LoadError href={href} />;
  }

  const Form = STAGE_FORMS[slug];
  const readOnly = !data.canEdit;
  return (
    <StageFrame
      key={slug}
      stages={data.stages.map(({ slug: s, name, href: h, status }) => ({
        slug: s,
        name,
        href: h,
        status,
      }))}
      current={slug}
      readOnly={readOnly}
      dismissFirstVisit={!data.firstVisitDismissed}
    >
      {Form ? (
        <Form data={data} readOnly={readOnly} />
      ) : (
        <LoadError href={href} />
      )}
    </StageFrame>
  );
}
