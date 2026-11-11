// Call to action block (CONT-03, CONT-04, D31; invariants 6 and 7;
// 03-UI-SPEC "Text & image / Text / CTA").
//
// Ported from donor src/components/sections/CtaBannerSection.tsx. Centered heading,
// description (plain text, max 56ch) and one primary button. The donor's dark panel and
// its on-dark text overrides are dropped: the row band already carries the ground, and
// a second fill inside it would be off-theme styling. No placeholder copy.
import type { CtaBannerContent } from "@cds/core/content";
import { RowRenderer } from "./RowRenderer";
import { SiteButton } from "./SiteButton";
import { BODY_CLASS, HEADING_CLASSES } from "./types";
import { text } from "./urls";
import type { SectionComponentProps } from "./types";

export function CtaBannerSection({
  content,
  layout,
  background,
  isH1Owner,
}: SectionComponentProps<CtaBannerContent>) {
  const c = (content ?? {}) as CtaBannerContent;
  const heading = text(c.heading);
  const description = text(c.description);
  const Heading = isH1Owner ? "h1" : "h2";

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="mx-auto flex flex-col items-center gap-6 text-center">
        {heading && (
          <Heading className={HEADING_CLASSES[isH1Owner ? 1 : 2]}>
            {heading}
          </Heading>
        )}
        {description && (
          <p className={`${BODY_CLASS} max-w-[56ch]`}>{description}</p>
        )}
        <SiteButton
          text={c.button_text ?? ""}
          style="primary"
          href={c.button_link}
        />
      </div>
    </RowRenderer>
  );
}
