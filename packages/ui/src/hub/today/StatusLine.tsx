// StatusLine (11-17; DASH-19, DASH-30; 11-UI-SPEC "Today" § 1; D-UI-P11-13). The Today
// H1 is the time-of-day greeting in business time (the caller passes it in), with the "?"
// for Today help. Under it, one wrapping line: the stage badge (words, never colour alone),
// the stage sentence and the preview / site link (new tab). Stages before the build
// (intake, fit_review, empty) have no line. Server-safe: no hooks.
import type { StageName } from "@cds/core/today";
import { STAGE_LINE } from "@cds/core/today";
import { ExternalLink } from "lucide-react";
import type { HubLinkComponent } from "../AddonCard";
import { Badge } from "../Badge";
import { ScreenHeader } from "../shell/ScreenHeader";
import { STAGE_BADGE_TONE, TODAY_COPY } from "./copy";

export interface StatusLineProps {
  /** "Good morning, Maria" or "Good morning" (no first name on file). */
  greeting: string;
  stage: StageName | string;
  /** The site's primary host (the preview host until the domain move). */
  host: string | null;
  helpId?: string;
  onHelp?: (helpId: string) => void;
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "inline-flex items-center gap-1 rounded font-semibold text-hub-accent underline " +
  "underline-offset-2 hover:text-hub-accent-hover focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export function StatusLine({
  greeting,
  stage,
  host,
  helpId = "today",
  onHelp,
  LinkComponent,
}: StatusLineProps) {
  const known = stage as StageName;
  const words = STAGE_LINE[known];
  const tone = STAGE_BADGE_TONE[known];
  const live = stage === "live";
  const href = host ? `https://${host}` : null;
  const linkLabel = live ? TODAY_COPY.viewSite : TODAY_COPY.viewPreview;
  return (
    <div
      className="flex flex-col gap-2"
      data-today-status=""
      data-tour="today-status"
    >
      <ScreenHeader
        title={greeting}
        helpId={helpId}
        helpName="Today"
        onHelp={onHelp}
        LinkComponent={LinkComponent}
      />
      {words && tone ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-hub text-base text-hub-ink">
          <Badge tone={tone}>{words}</Badge>
          {live ? (
            host ? (
              <span>
                {TODAY_COPY.liveLead}{" "}
                <strong className="font-semibold">{host}</strong>.
              </span>
            ) : null
          ) : (
            <span>
              {stage === "ready_for_review"
                ? TODAY_COPY.statusReview
                : TODAY_COPY.statusBuilt}
            </span>
          )}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              {linkLabel}
              <ExternalLink aria-hidden size={14} strokeWidth={2} />
              <span className="sr-only"> {TODAY_COPY.newTab}</span>
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
