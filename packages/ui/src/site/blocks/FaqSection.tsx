// FaqSection (07-21; CONT-27, CONT-35; 07-UI-SPEC "FAQ"; T-07-21-02).
//
// Native <details>/<summary>, so it works without JavaScript. Renders faqEntries(content):
// questions without an answer are skipped; none left renders nothing. The first item is
// open only when open_first. Summary: question (body 600, min-height 56px) + a 20px
// ChevronDown (text-muted) that rotates 180deg in 150ms, instant under reduced motion.
// Answers are sanitized at render (sanitizeRichText, as TextOnlySection) on top of the
// save/publish mapRichText pass, into .site-prose. The heading is an <h2>: only the Hero or
// the page title owns the page H1. --site-* roles only; the focus ring is the global
// [data-site] :focus-visible rule. Server component.
import { faqEntries, type FaqBlockContent } from "@cds/core/content";
import { sanitizeRichText } from "@cds/core/content/sanitize";
import { ChevronDown } from "lucide-react";
import { RowRenderer } from "../RowRenderer";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type SectionComponentProps,
} from "../types";
import { text } from "../urls";

export function FaqSection({
  content,
  layout,
  background,
}: SectionComponentProps<FaqBlockContent>) {
  const c = (content ?? {}) as FaqBlockContent;
  const entries = faqEntries(c)
    .map((e) => ({
      id: e.id,
      question: text(e.question),
      answer: sanitizeRichText(e.answer),
    }))
    .filter((e) => e.answer.trim() !== "");
  if (entries.length === 0) return null;
  const heading = text(c.heading);
  const openFirst = c.open_first === true;

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-6">
        {heading && <h2 className={HEADING_CLASSES[2]}>{heading}</h2>}
        <div className="border-b border-site-border">
          {entries.map((entry, i) => (
            <details
              key={entry.id || i}
              open={openFirst && i === 0 ? true : undefined}
              className="group border-t border-site-border"
            >
              <summary
                className={`${BODY_CLASS} flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-site-text [&::-webkit-details-marker]:hidden`}
              >
                <span>{entry.question}</span>
                <ChevronDown
                  aria-hidden="true"
                  focusable="false"
                  className="size-5 shrink-0 text-site-text-muted transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <div
                className="site-prose pb-4"
                dangerouslySetInnerHTML={{ __html: entry.answer }}
              />
            </details>
          ))}
        </div>
      </div>
    </RowRenderer>
  );
}
