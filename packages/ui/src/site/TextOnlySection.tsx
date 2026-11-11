// Text block (CONT-03, CONT-04, CONT-09, D31; invariants 6 and 7).
//
// Ported from donor src/components/sections/TextOnlySection.tsx: a heading and rich text,
// full width. Rich text is sanitized on the render path into .site-prose (T-03-25).
import { sanitizeRichText } from "@cds/core/content/sanitize";
import type { TextOnlyContent } from "@cds/core/content";
import { RowRenderer } from "./RowRenderer";
import { HEADING_CLASSES } from "./types";
import { text } from "./urls";
import type { SectionComponentProps } from "./types";

export function TextOnlySection({
  content,
  layout,
  background,
  isH1Owner,
}: SectionComponentProps<TextOnlyContent>) {
  const c = (content ?? {}) as TextOnlyContent;
  const heading = text(c.heading);
  const body = sanitizeRichText(c.text);
  const Heading = isH1Owner ? "h1" : "h2";

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-6">
        {heading && (
          <Heading className={HEADING_CLASSES[isH1Owner ? 1 : 2]}>
            {heading}
          </Heading>
        )}
        {body.trim() !== "" && (
          <div
            className="site-prose"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        )}
      </div>
    </RowRenderer>
  );
}
