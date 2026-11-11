// Help article (11-46; DASH-17, D110; 11-UI-SPEC "Help article" lines 603-610). Read mode,
// one 720px column: back link "← Help", ScreenHeader H1 = the article title, then "Turn it
// on" (when the how-to has Activate steps) and "Use it", each an <ol> of steps (Body, 68ch,
// 16px apart) with the expected result beneath in Label ink-muted (TrainingDrawer pattern),
// then a secondary "Go to {screen}" when the app found a screen the person can open. No video
// area while every video is null (P5 rule). Tours arrive in 11-47/11-48.
// T-11-46-02: steps are baked text; inline marks (**bold**, `code`, [label](file.md)) become
// React elements, never raw HTML. A link becomes a Help link only when `linkFor` returns one
// (an article this person may read); otherwise its label stays plain text.
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { buttonClasses } from "../Button";
import { ScreenHeader } from "../shell/ScreenHeader";
import { HELP_COPY } from "./copy";
import { TOUR_COPY } from "./tours";

export type HelpStepView = { screen: string; action: string; expected: string };

export interface HelpArticleProps {
  title: string;
  activate: readonly HelpStepView[];
  use: readonly HelpStepView[];
  /** The screen the article explains, when the person can open it. */
  goTo?: { label: string; href: string } | null;
  /** 11-48: the screen with `?tour=<id>`, when the screen has a first-use tour. */
  tourHref?: string | null;
  /** href for a markdown link target ("profile-and-alerts.md"), or null to keep plain text. */
  linkFor?: (target: string) => string | null;
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

const TOKEN = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Inline markdown marks to React nodes (text only; T-11-46-02). */
export function inlineMarks(
  text: string,
  linkFor: ((target: string) => string | null) | undefined,
  Link: HubLinkComponent | "a",
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push(<strong key={key++}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      out.push(
        <code
          key={key++}
          className="rounded bg-hub-surface-2 px-1 font-mono text-[0.9em] break-words"
        >
          {m[2]}
        </code>,
      );
    } else {
      const href = linkFor?.(m[4] ?? "") ?? null;
      out.push(
        href ? (
          <Link key={key++} href={href} className={LINK}>
            {m[3]}
          </Link>
        ) : (
          m[3]
        ),
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Steps({
  heading,
  steps,
  linkFor,
  Link,
  id,
}: {
  heading: string;
  steps: readonly HelpStepView[];
  linkFor: HelpArticleProps["linkFor"];
  Link: HubLinkComponent | "a";
  id: string;
}) {
  return (
    <section aria-labelledby={id} className="mt-8" data-help-steps={id}>
      <h2 id={id} className="text-xl leading-tight font-semibold">
        {heading}
      </h2>
      <ol className="mt-4 flex max-w-[68ch] list-decimal flex-col gap-4 pl-6 marker:font-semibold">
        {steps.map((step, i) => (
          <li key={i} className="text-base">
            <p>
              {step.screen ? (
                <span className="font-semibold">
                  {inlineMarks(step.screen, linkFor, Link)}:{" "}
                </span>
              ) : null}
              {inlineMarks(step.action, linkFor, Link)}
            </p>
            {step.expected ? (
              <p className="mt-1 text-sm text-hub-ink-muted">
                {inlineMarks(step.expected, linkFor, Link)}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function HelpArticle({
  title,
  activate,
  use,
  goTo,
  tourHref,
  linkFor,
  LinkComponent,
}: HelpArticleProps) {
  const Link = LinkComponent ?? "a";
  return (
    <article
      className="flex w-full max-w-[720px] flex-col font-hub text-hub-ink"
      data-help-article=""
    >
      <Link
        href={HELP_COPY.helpHref}
        className={`${LINK} inline-flex w-fit items-center gap-1 text-sm`}
        data-help-back=""
      >
        <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
        {HELP_COPY.back}
      </Link>
      <div className="mt-4">
        <ScreenHeader
          title={title}
          helpId="help"
          helpName={HELP_COPY.title}
          LinkComponent={LinkComponent}
        />
      </div>
      {activate.length > 0 ? (
        <Steps
          heading={HELP_COPY.activate}
          steps={activate}
          linkFor={linkFor}
          Link={Link}
          id="help-activate"
        />
      ) : null}
      {use.length > 0 ? (
        <Steps
          heading={HELP_COPY.use}
          steps={use}
          linkFor={linkFor}
          Link={Link}
          id="help-use"
        />
      ) : null}
      {goTo ? (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href={goTo.href}
            className={buttonClasses("secondary")}
            data-help-goto=""
          >
            {HELP_COPY.goTo(goTo.label)}
          </Link>
          {tourHref ? (
            <Link
              href={tourHref}
              className={buttonClasses("ghost")}
              data-help-tour=""
            >
              {TOUR_COPY.showTour}
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
